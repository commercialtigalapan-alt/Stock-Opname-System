-- 031: Optimasi upload inventory 8.000+ item (Postgres statement timeout).
-- Prasyarat: 028, 029, 030 sudah terpasang; backup data dulu.
-- Eksekusi skrip ini tidak mengubah row inventory, SO, BA, maupun data historis.
-- Hanya mengganti 2 fungsi RPC, menambah 1 helper internal.
-- Menjaga satu transaksi all-or-nothing dan pembatasan per toko.
BEGIN;
DO $prereq$ BEGIN
 IF to_regprocedure('public.tsi_so_upload_prepare(text,jsonb)') IS NULL OR
    to_regprocedure('public.tsi_so_upload(text,jsonb)') IS NULL OR
    to_regclass('public.tsi_so_item_pending_map') IS NULL OR
    to_regclass('public.tsi_so_item_sku_map') IS NULL THEN
  RAISE EXCEPTION 'Migrasi 028 dan 029 harus dipasang sebelum 031.';
 END IF;
END $prereq$;

CREATE OR REPLACE FUNCTION public.tsi_so_upload_prepare(p_store text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_count int; v_bad int; v_rows jsonb; r text; conflict_sku text;
BEGIN
 r:=public.tsi_so_authorize(p_store,true);
 IF r NOT IN ('store','admin','spv') THEN RAISE EXCEPTION 'Tidak memiliki akses upload.'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Data inventory harus array.'; END IF;
 v_count:=jsonb_array_length(p_rows);
 IF v_count NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Upload 1 sampai 10000 SKU per batch.'; END IF;
 SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_rows) j
 WHERE length(btrim(coalesce(j->>'name',''))) NOT BETWEEN 1 AND 250
    OR coalesce(j->>'ending','') !~ '^[0-9]{1,12}$'
    OR coalesce(nullif(j->>'cost',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
    OR coalesce(nullif(j->>'retail',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
 IF v_bad>0 THEN RAISE EXCEPTION 'Ada % baris tidak valid (Nama Item, Ending, Cost, Retail).',v_bad; END IF;
 -- Hanya exact normalized-name (spasi ganda direduksi) yang boleh dicocokkan.
 -- Kode di CSV dipakai hanya jika berbeda dari nama item.
 SELECT coalesce(jsonb_agg(
   j || jsonb_build_object('sku',
     coalesce(m.official_sku,
       CASE WHEN upper(btrim(coalesce(j->>'sku','')))<>upper(btrim(j->>'name'))
                  AND btrim(coalesce(j->>'sku',''))<>''
                  AND upper(btrim(j->>'sku')) NOT LIKE 'PENDING-%'
            THEN upper(btrim(j->>'sku')) ELSE NULL END,
       CASE WHEN pm.item_variant_id IS NOT NULL THEN 'PENDING-'||pm.item_variant_id
            ELSE 'PENDING-N'||upper(md5(upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g')))) END),
     '_sku_source',CASE WHEN m.official_sku IS NOT NULL THEN 'library'
       WHEN upper(btrim(coalesce(j->>'sku','')))<>upper(btrim(j->>'name'))
         AND btrim(coalesce(j->>'sku',''))<>''
         AND upper(btrim(j->>'sku')) NOT LIKE 'PENDING-%' THEN 'file'
       WHEN pm.item_variant_id IS NOT NULL THEN 'pending_library' ELSE 'pending_unknown' END
   ) ORDER BY ord),'[]'::jsonb) INTO v_rows
 FROM jsonb_array_elements(p_rows) WITH ORDINALITY z(j,ord)
 LEFT JOIN public.tsi_so_item_sku_map m
   ON m.item_key=upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g'))
 LEFT JOIN public.tsi_so_item_pending_map pm
   ON pm.item_key=upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g'));
 SELECT count(*) INTO v_bad FROM jsonb_array_elements(v_rows) j
 WHERE length(btrim(j->>'sku')) NOT BETWEEN 1 AND 80;
 IF v_bad>0 THEN RAISE EXCEPTION '% SKU melebihi batas panjang atau kosong.',v_bad; END IF;
 SELECT sku INTO conflict_sku FROM (
  SELECT j->>'sku' sku,count(*) cnt FROM jsonb_array_elements(v_rows) j
  GROUP BY j->>'sku' HAVING count(*)>1 LIMIT 1
 ) d;
 IF conflict_sku IS NOT NULL THEN
  RAISE EXCEPTION 'SKU % duplikat setelah pencocokan. Perbaiki data sumber sebelum upload.',conflict_sku;
 END IF;
 RETURN v_rows;
END; $fn$;

REVOKE ALL ON FUNCTION public.tsi_so_upload_prepare(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.tsi_so_upload_rewrite_scope_fast(p_scope jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_out jsonb;
BEGIN
 IF p_scope IS NULL OR jsonb_typeof(p_scope)<>'array' THEN RETURN p_scope; END IF;
 -- Alias dibentuk hanya saat transaksi upload. JOIN indeks, bukan scan inventory tiap SKU.
 SELECT coalesce(jsonb_agg(to_jsonb(coalesce(a.sku,e.val)) ORDER BY e.ord),'[]'::jsonb)
 INTO v_out FROM jsonb_array_elements_text(p_scope) WITH ORDINALITY e(val,ord)
 LEFT JOIN pg_temp._up031_alias a
   ON a.alias_key=upper(regexp_replace(btrim(e.val),'[[:space:]]+',' ','g'));
 RETURN v_out;
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_upload_rewrite_scope_fast(jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.tsi_so_upload(p_store text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_rows jsonb; v_count int; v_id uuid; v_synced int; v_locked int;
 v_matched int; v_pending int; v_fixed int; v_conflict text;
BEGIN
 -- Transaksi tunggal per toko; kegagalan membatalkan semua perubahan.
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 v_rows:=public.tsi_so_upload_prepare(p_store,p_rows); -- otorisasi + validasi 1-10000 item
 v_count:=jsonb_array_length(v_rows);

 -- Uraikan JSON sekali, beri indeks untuk semua join SO, menghindari O(N x M).
 CREATE TEMP TABLE IF NOT EXISTS pg_temp._up031_stage(
   sku text NOT NULL, item_name text NOT NULL, name_key text NOT NULL,
   category text NOT NULL, ending bigint NOT NULL, cost numeric NOT NULL,
   retail numeric NOT NULL, sku_source text NOT NULL
 ) ON COMMIT DROP;
 TRUNCATE TABLE pg_temp._up031_stage;
 INSERT INTO pg_temp._up031_stage(sku,item_name,name_key,category,ending,cost,retail,sku_source)
 SELECT upper(btrim(j->>'sku')),btrim(j->>'name'),
  upper(regexp_replace(btrim(j->>'name'),'[[:space:]]+',' ','g')),
  left(coalesce(j->>'category',''),120),(j->>'ending')::bigint,
  coalesce(nullif(j->>'cost',''),'0')::numeric,
  coalesce(nullif(j->>'retail',''),'0')::numeric,coalesce(j->>'_sku_source','')
 FROM jsonb_array_elements(v_rows) j;
 CREATE INDEX IF NOT EXISTS _up031_stage_name_idx ON pg_temp._up031_stage(name_key);
 CREATE INDEX IF NOT EXISTS _up031_stage_sku_idx ON pg_temp._up031_stage(sku);
 ANALYZE pg_temp._up031_stage;

 SELECT name_key INTO v_conflict FROM pg_temp._up031_stage
 GROUP BY name_key HAVING count(*)>1 LIMIT 1;
 IF v_conflict IS NOT NULL THEN
  RAISE EXCEPTION 'Nama item % ganda dalam inventory. Periksa sebelum upload.',v_conflict;
 END IF;
 SELECT count(*) FILTER(WHERE sku_source='library'),
    count(*) FILTER(WHERE sku_source IN ('pending_library','pending_unknown'))
 INTO v_matched,v_pending FROM pg_temp._up031_stage;

 -- Pertahankan validasi konflik SO aktif. Mencari nama melalui indeks stage.
 SELECT l.sku INTO v_conflict
 FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 JOIN pg_temp._up031_stage s ON s.name_key=upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))
 WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
   AND l.sku<>s.sku AND upper(btrim(l.sku))<>upper(btrim(l.item_name))
   AND l.sku NOT LIKE 'PENDING-%' LIMIT 1;
 IF v_conflict IS NOT NULL THEN
  RAISE EXCEPTION 'SO aktif memiliki SKU % berbeda untuk nama item yang sama. Upload dibatalkan agar stok tidak menjadi 0; periksa pemetaan SKU.',v_conflict;
 END IF;
 SELECT x.final_sku INTO v_conflict FROM (
  SELECT l.cycle_id,coalesce(s.sku,l.sku) final_sku,count(*) qty
  FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
  LEFT JOIN pg_temp._up031_stage s
   ON s.name_key=upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))
  WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
  GROUP BY l.cycle_id,coalesce(s.sku,l.sku) HAVING count(*)>1 LIMIT 1
 ) x;
 IF v_conflict IS NOT NULL THEN
  RAISE EXCEPTION 'Konflik SKU % pada SO aktif. Tidak ada data yang diubah.',v_conflict;
 END IF;

 -- Akses hanya ke toko yang dipilih; identitas/qty historis tetap tersimpan.
 INSERT INTO public.tsi_so_uploads(store_code,uploaded_by,sku_count)
 VALUES(p_store,auth.uid(),v_count) RETURNING id INTO v_id;
 DELETE FROM public.tsi_so_inventory WHERE store_code=p_store;
 INSERT INTO public.tsi_so_inventory(store_code,sku,item_name,category,ending,cost,retail_price,upload_id)
 SELECT p_store,sku,item_name,category,ending,cost,retail,v_id FROM pg_temp._up031_stage;

 CREATE TEMP TABLE IF NOT EXISTS pg_temp._up028_rekey(line_id uuid PRIMARY KEY,new_sku text NOT NULL)
 ON COMMIT DROP;
 TRUNCATE TABLE pg_temp._up028_rekey;
 INSERT INTO pg_temp._up028_rekey(line_id,new_sku)
 SELECT l.id,s.sku FROM public.tsi_so_lines l
 JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 JOIN pg_temp._up031_stage s
   ON s.name_key=upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))
 WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
   AND l.sku<>s.sku
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

 -- Perbarui system qty hanya jika berubah; qty aktual/alasan tidak tersentuh.
 UPDATE public.tsi_so_lines l
 SET system_at_start=coalesce((SELECT i.ending FROM public.tsi_so_inventory i
   WHERE i.store_code=p_store AND i.sku=l.sku),0)
 WHERE l.cycle_id IN (SELECT c.id FROM public.tsi_so_cycles c
   WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT'))
 AND l.system_at_start IS DISTINCT FROM coalesce((SELECT i.ending FROM public.tsi_so_inventory i
   WHERE i.store_code=p_store AND i.sku=l.sku),0);
 GET DIAGNOSTICS v_synced=ROW_COUNT;

 -- Alias indeks untuk mengganti scope setiap jadwal: SKU lama/nama/PENDING -> SKU terbaru.
 CREATE TEMP TABLE IF NOT EXISTS pg_temp._up031_alias(alias_key text PRIMARY KEY,sku text NOT NULL)
 ON COMMIT DROP;
 TRUNCATE TABLE pg_temp._up031_alias;
 INSERT INTO pg_temp._up031_alias(alias_key,sku)
 SELECT sku,sku FROM pg_temp._up031_stage ORDER BY sku
 ON CONFLICT(alias_key) DO NOTHING;
 INSERT INTO pg_temp._up031_alias(alias_key,sku)
 SELECT name_key,sku FROM pg_temp._up031_stage ORDER BY sku
 ON CONFLICT(alias_key) DO NOTHING;
 INSERT INTO pg_temp._up031_alias(alias_key,sku)
 SELECT 'PENDING-'||pm.item_variant_id,s.sku
 FROM pg_temp._up031_stage s JOIN public.tsi_so_item_pending_map pm ON pm.item_key=s.name_key
 ORDER BY s.sku ON CONFLICT(alias_key) DO NOTHING;
 INSERT INTO pg_temp._up031_alias(alias_key,sku)
 SELECT 'PENDING-N'||upper(md5(name_key)),sku
 FROM pg_temp._up031_stage ORDER BY sku
 ON CONFLICT(alias_key) DO NOTHING;

 UPDATE public.tsi_so_cycles c SET
  scope_skus=public.tsi_so_upload_rewrite_scope_fast(c.scope_skus),
  scope_rule=CASE WHEN jsonb_typeof(c.scope_rule)='object' AND c.scope_rule ? 'skus'
    THEN jsonb_set(c.scope_rule,'{skus}',coalesce(public.tsi_so_upload_rewrite_scope_fast(c.scope_rule->'skus'),'[]'::jsonb),true)
    ELSE c.scope_rule END,
  team_map=CASE WHEN jsonb_typeof(c.team_map)='array'
    THEN (SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(z.t->'rule')='object' AND (z.t->'rule') ? 'skus' THEN
        jsonb_set(z.t,'{rule,skus}',coalesce(public.tsi_so_upload_rewrite_scope_fast(z.t->'rule'->'skus'),'[]'::jsonb),true)
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
 'active_so_sku_converted',v_fixed,'synced_lines',v_synced,'locked_lines',v_locked,
 'upload_optimization','031-indexed-staging'));
 RETURN jsonb_build_object('upload_id',v_id,'sku_count',v_count,'sku_auto_from_library',v_matched,
 'pending_sku',v_pending,'active_so_sku_converted',v_fixed,'synced_lines',v_synced,
 'locked_lines',v_locked);
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_upload(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_upload(text,jsonb) TO authenticated;

COMMIT;
