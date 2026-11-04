-- 034: Kunci item aman per toko, hotfix sinkronisasi rasio, dan statistik warna yang akurat.
-- Jalankan SETELAH migrasi 032 REVISI; frontend v37 dipasang sesudah SQL berhasil.
-- TIDAK mengubah tabel hasil Counting, BA, approval atau rasio SO historis.
BEGIN;
SET LOCAL lock_timeout = '15s';

CREATE TABLE IF NOT EXISTS public.tsi_so_item_unlocks (
  store_code text NOT NULL REFERENCES public.tsi_so_stores(code),
  item_name text NOT NULL,
  reason text NOT NULL,
  granted_by uuid NOT NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  consumed_at timestamptz,
  PRIMARY KEY (store_code,item_name)
);
ALTER TABLE public.tsi_so_item_unlocks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tsi_so_item_unlocks FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS tsi_so_item_unlocks_active_idx
  ON public.tsi_so_item_unlocks(store_code,item_name)
  WHERE revoked_at IS NULL AND consumed_at IS NULL;

-- Cek role secara server-side, hanya Admin/Master. Tidak menerima perintah lintas toko.
CREATE OR REPLACE FUNCTION public.tsi_so_item_lock_override(
  p_store text,p_items text[],p_action text,p_reason text DEFAULT ''
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_role text; v_items text[]; v_total int; v_unknown int; v_changed int;
BEGIN
  SELECT role INTO v_role FROM public.tsi_so_users WHERE user_id=auth.uid() AND active;
  IF v_role IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Hanya Master/Admin yang dapat membuka kunci item.'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.tsi_so_stores WHERE code=p_store) THEN RAISE EXCEPTION 'Toko tidak ditemukan.'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('UNLOCK','LOCK') THEN RAISE EXCEPTION 'Aksi tidak dikenali.'; END IF;
  SELECT array_agg(DISTINCT btrim(v)) INTO v_items
  FROM unnest(coalesce(p_items,ARRAY[]::text[])) v WHERE btrim(v)<>'';
  v_total:=coalesce(array_length(v_items,1),0);
  IF v_total<1 OR v_total>50 THEN RAISE EXCEPTION 'Pilih 1 sampai 50 item.'; END IF;
  IF p_action='UNLOCK' AND length(btrim(coalesce(p_reason,'')))<5 THEN
    RAISE EXCEPTION 'Alasan pembukaan kunci minimal 5 karakter.';
  END IF;
  IF length(coalesce(p_reason,''))>300 THEN RAISE EXCEPTION 'Alasan maksimal 300 karakter.'; END IF;
  SELECT count(*) INTO v_unknown FROM unnest(v_items) v
   WHERE NOT EXISTS(SELECT 1 FROM public.tsi_so_inventory i WHERE i.store_code=p_store AND i.sku=v);
  IF v_unknown>0 THEN RAISE EXCEPTION '% item tidak ada di inventory toko yang dipilih.',v_unknown; END IF;
  -- Lock serial untuk operasi unlock satu toko. Tidak menyentuh baris SO historis.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
  IF p_action='UNLOCK' THEN
    INSERT INTO public.tsi_so_item_unlocks(store_code,item_name,reason,granted_by,granted_at,revoked_at,consumed_at)
    SELECT p_store,v,btrim(p_reason),auth.uid(),now(),NULL,NULL FROM unnest(v_items) v
    ON CONFLICT (store_code,item_name) DO UPDATE SET reason=excluded.reason,granted_by=excluded.granted_by,
       granted_at=now(),revoked_at=NULL,consumed_at=NULL;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  ELSE
    UPDATE public.tsi_so_item_unlocks u SET revoked_at=now()
     WHERE u.store_code=p_store AND u.item_name=ANY(v_items)
       AND u.revoked_at IS NULL AND u.consumed_at IS NULL;
    GET DIAGNOSTICS v_changed = ROW_COUNT;
  END IF;
  INSERT INTO public.tsi_so_audit(user_id,store_code,event,meta) VALUES(
   auth.uid(),p_store,CASE WHEN p_action='UNLOCK' THEN 'ITEM_UNLOCK_GRANTED' ELSE 'ITEM_UNLOCK_REVOKED' END,
   jsonb_build_object('items',to_jsonb(v_items),'count',v_changed,'reason',left(coalesce(p_reason,''),300)));
  RETURN jsonb_build_object('changed',v_changed,'action',p_action,'store',p_store);
END;$fn$;
REVOKE ALL ON FUNCTION public.tsi_so_item_lock_override(text,text[],text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_item_lock_override(text,text[],text,text) TO authenticated;

-- Perhitungan eligibility untuk Cakupan, penjadwalan, scope item, dan scope tim.
-- Prioritas: 0x selalu dapat dipilih; putaran terendah mengikuti aturan lama;
-- item yang dibuka Master dapat dipilih 1 kali lagi meskipun rasionya lebih tinggi.
CREATE OR REPLACE FUNCTION public.tsi_so_eligible(p_store text)
RETURNS SETOF text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
  WITH rounds AS MATERIALIZED (
    SELECT sku,so_count FROM public.tsi_so_rounds(p_store)
  ), lowest AS (SELECT coalesce(min(so_count),0) n FROM rounds)
  SELECT r.sku FROM rounds r CROSS JOIN lowest l
  LEFT JOIN public.tsi_so_item_unlocks u ON u.store_code=p_store AND u.item_name=r.sku
  WHERE r.so_count=l.n OR r.so_count=0
    OR (u.item_name IS NOT NULL AND u.revoked_at IS NULL AND u.consumed_at IS NULL);
$fn$;
REVOKE ALL ON FUNCTION public.tsi_so_eligible(text) FROM PUBLIC,anon,authenticated;

-- Menandai izin sekali pakai sebagai terpakai hanya ketika SO baru SUBMITTED.
-- Jika jadwal dibatalkan sebelum submit, izin tetap tersedia. Riwayat SO tidak diubah.
CREATE OR REPLACE FUNCTION public.tsi_so_consume_item_unlocks()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  UPDATE public.tsi_so_item_unlocks u SET consumed_at=now()
  WHERE u.store_code=NEW.store_code AND u.revoked_at IS NULL AND u.consumed_at IS NULL
    AND EXISTS(SELECT 1 FROM public.tsi_so_lines l WHERE l.cycle_id=NEW.id AND l.sku=u.item_name);
  RETURN NEW;
END;$fn$;
REVOKE ALL ON FUNCTION public.tsi_so_consume_item_unlocks() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS tsi_so_item_unlocks_on_submit ON public.tsi_so_cycles;
CREATE TRIGGER tsi_so_item_unlocks_on_submit AFTER UPDATE OF status ON public.tsi_so_cycles
FOR EACH ROW WHEN (NEW.status='SUBMITTED' AND OLD.status IN ('COUNTING','RECOUNT'))
EXECUTE FUNCTION public.tsi_so_consume_item_unlocks();

-- Cakupan item: semua ringkasan dan filter menggunakan fungsi eligible yang SAMA
-- seperti fungsi pemilihan scope, sehingga tidak ada status UI dan jadwal berbeda.
CREATE OR REPLACE FUNCTION public.tsi_so_sku_coverage(
 p_store text,p_filter text DEFAULT 'ALL',p_search text DEFAULT '',
 p_offset integer DEFAULT 0,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.tsi_so_authorize(p_store,true);
 IF p_filter IS NULL OR p_filter NOT IN ('ALL','BELUM','SUDAH','DIPILIH','TERKUNCI','DIBUKA') THEN
   RAISE EXCEPTION 'Filter cakupan tidak dikenal.'; END IF;
 IF p_offset<0 OR p_limit NOT BETWEEN 1 AND 100 OR length(coalesce(p_search,''))>120 THEN
   RAISE EXCEPTION 'Parameter pencarian/paginasi salah.'; END IF;
 WITH base AS MATERIALIZED (
  SELECT r.sku,r.item_name,r.category,r.so_count,(e.sku IS NOT NULL) eligible,
         (u.item_name IS NOT NULL AND u.revoked_at IS NULL AND u.consumed_at IS NULL) unlocked,
         u.reason unlock_reason
  FROM public.tsi_so_rounds(p_store) r
  LEFT JOIN (SELECT sku FROM public.tsi_so_eligible(p_store)) e ON e.sku=r.sku
  LEFT JOIN public.tsi_so_item_unlocks u ON u.store_code=p_store AND u.item_name=r.sku
 ), summary AS (
  SELECT jsonb_build_object('total',count(*),'belum',count(*) FILTER(WHERE so_count=0),
   'sudah',count(*) FILTER(WHERE so_count>0),'dipilih',count(*) FILTER(WHERE eligible),
   'terkunci',count(*) FILTER(WHERE NOT eligible),'dibuka',count(*) FILTER(WHERE unlocked),
   'min_ratio',coalesce(min(so_count),0),'max_ratio',coalesce(max(so_count),0)) val FROM base
 ), filtered AS MATERIALIZED (
  SELECT * FROM base b WHERE
   (coalesce(p_search,'')='' OR b.item_name ILIKE '%'||p_search||'%')
   AND (p_filter='ALL' OR (p_filter='BELUM' AND so_count=0) OR
   (p_filter='SUDAH' AND so_count>0) OR (p_filter='DIPILIH' AND eligible) OR
   (p_filter='TERKUNCI' AND NOT eligible) OR (p_filter='DIBUKA' AND unlocked))
 ), pg AS (SELECT * FROM filtered ORDER BY item_name LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('summary',(SELECT val FROM summary),
  'total_filtered',(SELECT count(*) FROM filtered),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('sku',sku,'name',item_name,
    'category',category,'ratio',so_count,'eligible',eligible,'unlocked',unlocked,
    'unlock_reason',CASE WHEN unlocked THEN unlock_reason ELSE NULL END,
    'status',CASE WHEN so_count=0 THEN 'BELUM' ELSE 'SUDAH' END) ORDER BY item_name)
    FROM pg),'[]'::jsonb)) INTO result;
 RETURN result;
END;$fn$;
REVOKE ALL ON FUNCTION public.tsi_so_sku_coverage(text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_sku_coverage(text,text,text,integer,integer) TO authenticated;

-- Statistik warna: jangan lagi menganggap setiap GRAND SO lama mencakup semua
-- Nama Item yang TERDAPAT di inventory HARI INI. Hitung dari rasio riil item.
CREATE OR REPLACE FUNCTION public.tsi_so_color_stats(p_store text,p_category text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_role text; v_result jsonb;
BEGIN
 v_role:=public.tsi_so_authorize(p_store,true);
 IF v_role NOT IN ('admin','spv','store') THEN RAISE EXCEPTION 'Akses ditolak.'; END IF;
 WITH inv AS MATERIALIZED (
   SELECT public.tsi_so_color_name(i.item_name,i.category) AS color,
      i.sku,coalesce(r.so_count,0) AS rounds,(e.sku IS NOT NULL) AS elig
   FROM public.tsi_so_inventory i
   LEFT JOIN public.tsi_so_sku_rounds r ON r.store_code=i.store_code AND r.sku=i.sku
   LEFT JOIN (SELECT sku FROM public.tsi_so_eligible(p_store)) e ON e.sku=i.sku
   WHERE i.store_code=p_store AND i.category=p_category
 ), agg AS (
   SELECT color,count(*) AS qty,count(*) FILTER(WHERE elig) AS eligible_count,
      count(*) FILTER(WHERE rounds=0) AS belum_count,
      count(*) FILTER(WHERE rounds>0) AS sudah_count,
      max(rounds) AS max_round
   FROM inv GROUP BY color
 )
 SELECT coalesce(jsonb_agg(jsonb_build_object('color',color,'sku_count',qty,
   'eligible_count',eligible_count,'belum_count',belum_count,'sudah_count',sudah_count,
   'so_count',max_round) ORDER BY qty DESC,color),'[]'::jsonb) INTO v_result FROM agg;
 RETURN v_result;
END;$fn$;
REVOKE ALL ON FUNCTION public.tsi_so_color_stats(text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_color_stats(text,text) TO authenticated;

-- Perbaikan DELETE tanpa WHERE pada Sinkronisasi Rasio versi 026.
-- Penting: detail SO yang sudah diarsipkan/dibersihkan TIDAK BISA dihitung ulang.
-- Karena itu, 'Terapkan' DITOLAK jika ada histori tak lengkap; preview tetap tersedia.
CREATE OR REPLACE FUNCTION public.tsi_so_rounds_resync(p_store text,p_apply boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE who text; unknown_history integer; archived integer; changed integer; sample jsonb;
BEGIN
 SELECT role INTO who FROM public.tsi_so_users WHERE user_id=auth.uid() AND active;
 IF who IS DISTINCT FROM 'admin' THEN RAISE EXCEPTION 'Hanya Admin.'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.tsi_so_stores WHERE code=p_store) THEN
  RAISE EXCEPTION 'Toko tidak ditemukan.'; END IF;
 -- Pertahankan identitas Nama Item: tidak kembali ke Item Library SKU lama.
 SELECT count(*) INTO unknown_history FROM public.tsi_so_cycles c
 WHERE c.store_code=p_store AND c.rounds_recorded
  AND (c.archived_at IS NOT NULL OR NOT EXISTS(
   SELECT 1 FROM public.tsi_so_lines l WHERE l.cycle_id=c.id));
 SELECT count(*) INTO archived FROM public.tsi_so_cycles c
 WHERE c.store_code=p_store AND c.rounds_recorded AND c.archived_at IS NOT NULL;
 WITH observed AS (
  SELECT l.sku,count(DISTINCT c.id)::integer AS qty
  FROM public.tsi_so_cycles c JOIN public.tsi_so_lines l ON l.cycle_id=c.id
  WHERE c.store_code=p_store AND c.rounds_recorded AND c.archived_at IS NULL
  GROUP BY l.sku
 ), diff AS (
  SELECT coalesce(o.sku,n.sku) sku,coalesce(o.so_count,0) old_qty,coalesce(n.qty,0) new_qty
  FROM (SELECT sku,so_count FROM public.tsi_so_sku_rounds WHERE store_code=p_store) o
  FULL JOIN observed n ON n.sku=o.sku
 ), flagged AS (SELECT * FROM diff WHERE old_qty<>new_qty)
 SELECT (SELECT count(*) FROM flagged),
        coalesce((SELECT jsonb_agg(jsonb_build_object('sku',sku,'dari',old_qty,'menjadi',new_qty)
                     ORDER BY sku) FROM (SELECT * FROM flagged ORDER BY sku LIMIT 50) x),'[]'::jsonb)
 INTO changed,sample;
 IF p_apply THEN
  IF changed=0 THEN RETURN jsonb_build_object('changed',0,'sample',sample,
    'archived_recorded',archived,'unverifiable_cycles',unknown_history,
    'can_apply',unknown_history=0,'applied',false); END IF;
  IF unknown_history>0 THEN RAISE EXCEPTION
   'Sinkronisasi diblokir: % SO memiliki detail yang diarsipkan/dibersihkan. Rasio historis tidak boleh direset; gunakan Buka Kunci Master.',unknown_history;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
  DELETE FROM public.tsi_so_sku_rounds WHERE store_code=p_store;
  INSERT INTO public.tsi_so_sku_rounds(store_code,sku,so_count,last_date)
   SELECT p_store,l.sku,count(DISTINCT c.id)::integer,max(c.planned_date)
   FROM public.tsi_so_cycles c JOIN public.tsi_so_lines l ON l.cycle_id=c.id
   WHERE c.store_code=p_store AND c.rounds_recorded AND c.archived_at IS NULL
   GROUP BY l.sku;
  INSERT INTO public.tsi_so_audit(user_id,store_code,event,meta)
   VALUES(auth.uid(),p_store,'ROUNDS_RESYNC',jsonb_build_object('changed',changed));
 END IF;
 RETURN jsonb_build_object('changed',changed,'sample',sample,'archived_recorded',archived,
   'unverifiable_cycles',unknown_history,'can_apply',unknown_history=0,'applied',p_apply);
END;$fn$;
REVOKE ALL ON FUNCTION public.tsi_so_rounds_resync(text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_rounds_resync(text,boolean) TO authenticated;
COMMIT;
