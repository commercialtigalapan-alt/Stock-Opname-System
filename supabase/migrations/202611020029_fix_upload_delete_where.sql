-- 029: Hotfix Upload & Ganti Inventory v31 -- DELETE requires a WHERE clause.
-- Akar masalah: SECURITY DEFINER tsi_so_upload() menjalankan DELETE pada tabel temp
-- pg_temp._up028_rekey tanpa WHERE, yang ditolak proteksi pg_safeupdate.
-- Aman: TRUNCATE HANYA tabel TEMP yang baru dibuat di dalam session ini.
-- Tidak menghapus/mengubah SO historis, BA, qty, ataupun inventory saat migrasi.
-- Prasyarat: migrasi 028 sudah diterapkan. Jalankan SQL ini di Supabase SQL Editor.
BEGIN;
DO $prereq$ BEGIN
 IF to_regclass('public.tsi_so_item_pending_map') IS NULL OR
    to_regprocedure('public.tsi_so_upload_prepare(text,jsonb)') IS NULL OR
    to_regprocedure('public.tsi_so_upload_check(text,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'Migrasi 028 belum lengkap. Terapkan migrasi 028 sebelum 029.';
 END IF;
END $prereq$;

CREATE OR REPLACE FUNCTION public.tsi_so_upload(p_store text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_rows jsonb; v_count int; v_id uuid; v_synced int; v_locked int;
 v_matched int; v_pending int; v_fixed int; v_bad int; v_conflict text;
BEGIN
 -- Kunci per toko SEBELUM membaca inventory/SO agar tidak tertimpa upload paralel.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 v_rows:=public.tsi_so_upload_prepare(p_store,p_rows);
 v_count:=jsonb_array_length(v_rows);
 SELECT count(*) FILTER(WHERE j->>'_sku_source'='library'),
   count(*) FILTER(WHERE j->>'_sku_source' IN ('pending_library','pending_unknown'))
 INTO v_matched,v_pending FROM jsonb_array_elements(v_rows) j;

 -- Bila SO aktif mempunyai kode lain yang tidak cocok, JANGAN set qty sistem ke 0.
 -- Kode nama lama / PENDING boleh dikonversi, kode resmi lain harus direview manual.
 SELECT l.sku INTO v_conflict
 FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 JOIN jsonb_array_elements(v_rows) j ON upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))=upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g'))
 WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
   AND l.sku<>j->>'sku' AND upper(btrim(l.sku))<>upper(btrim(l.item_name))
   AND l.sku NOT LIKE 'PENDING-%'
 LIMIT 1;
 IF v_conflict IS NOT NULL THEN
  RAISE EXCEPTION 'SO aktif memiliki SKU % berbeda untuk nama item yang sama. Upload dibatalkan agar stok tidak menjadi 0; periksa pemetaan SKU.',v_conflict;
 END IF;
 -- Preflight UNIQUE(cycle_id,sku) setelah konversi SKU pada SO aktif.
 SELECT q.final_sku INTO v_conflict FROM (
 SELECT l.cycle_id, coalesce(j->>'sku',l.sku) final_sku,count(*) qty
 FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 LEFT JOIN jsonb_array_elements(v_rows) j ON upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))=upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g'))
 WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
 GROUP BY l.cycle_id,coalesce(j->>'sku',l.sku) HAVING count(*)>1 LIMIT 1) q;
 IF v_conflict IS NOT NULL THEN
  RAISE EXCEPTION 'Konflik SKU % pada SO aktif. Tidak ada data yang diubah.',v_conflict;
 END IF;

 INSERT INTO public.tsi_so_uploads(store_code,uploaded_by,sku_count)
 VALUES(p_store,auth.uid(),v_count) RETURNING id INTO v_id;
 DELETE FROM public.tsi_so_inventory WHERE store_code=p_store;
 INSERT INTO public.tsi_so_inventory(store_code,sku,item_name,category,ending,cost,retail_price,upload_id)
 SELECT p_store,upper(btrim(j->>'sku')),btrim(j->>'name'),left(coalesce(j->>'category',''),120),
 (j->>'ending')::bigint,coalesce(nullif(j->>'cost',''),'0')::numeric,
 coalesce(nullif(j->>'retail',''),'0')::numeric,v_id FROM jsonb_array_elements(v_rows) j;

 -- Migrasikan hanya identitas baris COUNTING/RECOUNT; qty counting, alasan, team,
 -- riwayat approved dan SUBMITTED tidak disentuh.
 -- Dua tahap untuk menghindari benturan UNIQUE sementara saat kode ditukar.
 CREATE TEMP TABLE IF NOT EXISTS pg_temp._up028_rekey(line_id uuid PRIMARY KEY, new_sku text NOT NULL) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp._up028_rekey;
 INSERT INTO pg_temp._up028_rekey(line_id,new_sku)
 SELECT l.id,j->>'sku'
 FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 JOIN jsonb_array_elements(v_rows) j ON upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))=upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g'))
 WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
   AND l.sku<>j->>'sku'
   AND (upper(btrim(l.sku))=upper(btrim(l.item_name)) OR l.sku LIKE 'PENDING-%');
 SELECT count(*) INTO v_fixed FROM pg_temp._up028_rekey;
 IF EXISTS(SELECT 1 FROM public.tsi_so_lines l JOIN pg_temp._up028_rekey q
   ON l.sku='__UP028_'||md5(q.line_id::text)) THEN
  RAISE EXCEPTION 'Kode sementara migrasi berbenturan dengan data asli.';
 END IF;
 UPDATE public.tsi_so_lines l SET sku='__UP028_'||md5(q.line_id::text)
 FROM pg_temp._up028_rekey q WHERE l.id=q.line_id;
 UPDATE public.tsi_so_lines l SET sku=q.new_sku
 FROM pg_temp._up028_rekey q WHERE l.id=q.line_id;

 UPDATE public.tsi_so_lines l SET system_at_start=coalesce((
   SELECT i.ending FROM public.tsi_so_inventory i WHERE i.store_code=p_store AND i.sku=l.sku),0)
 WHERE l.cycle_id IN (SELECT c.id FROM public.tsi_so_cycles c
  WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT'));
 GET DIAGNOSTICS v_synced = ROW_COUNT;

 UPDATE public.tsi_so_cycles c SET
   scope_skus=public.tsi_so_upload_rewrite_scope(c.scope_skus,p_store),
   scope_rule=CASE WHEN jsonb_typeof(c.scope_rule)='object' AND c.scope_rule ? 'skus'
     THEN jsonb_set(c.scope_rule,'{skus}',coalesce(public.tsi_so_upload_rewrite_scope(c.scope_rule->'skus',p_store),'[]'::jsonb),true)
     ELSE c.scope_rule END,
   team_map=CASE WHEN jsonb_typeof(c.team_map)='array'
     THEN (SELECT coalesce(jsonb_agg(
       CASE WHEN jsonb_typeof(z.t->'rule')='object' AND (z.t->'rule') ? 'skus' THEN
         jsonb_set(z.t,'{rule,skus}',coalesce(public.tsi_so_upload_rewrite_scope(z.t->'rule'->'skus',p_store),'[]'::jsonb),true)
       ELSE z.t END ORDER BY z.ord),'[]'::jsonb)
       FROM jsonb_array_elements(c.team_map) WITH ORDINALITY z(t,ord))
     ELSE c.team_map END
 WHERE c.store_code=p_store AND c.status='SCHEDULED';

 SELECT count(*) INTO v_locked FROM public.tsi_so_lines l
 JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 WHERE c.store_code=p_store AND c.status='SUBMITTED';
 INSERT INTO public.tsi_so_audit(user_id,store_code,event,meta)
 VALUES(auth.uid(),p_store,'UPLOAD',jsonb_build_object('upload_id',v_id,'skus',v_count,
  'sku_auto_from_library',v_matched,'pending_sku',v_pending,
  'active_so_sku_converted',v_fixed,'synced_lines',v_synced,'locked_lines',v_locked));
 RETURN jsonb_build_object('upload_id',v_id,'sku_count',v_count,'sku_auto_from_library',v_matched,
  'pending_sku',v_pending,'active_so_sku_converted',v_fixed,
  'synced_lines',v_synced,'locked_lines',v_locked);
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_upload(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_upload(text,jsonb) TO authenticated;
COMMIT;
