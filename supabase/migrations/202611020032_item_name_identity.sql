-- TIGALAPAN 032 REVISI: satu transaksi untuk 11 duplikasi aman + migrasi Nama Item.
-- Jalankan file ini SEBAGAI PENGGANTI file 032 sebelumnya (bukan setelah 032 sukses).
-- Prasyarat: 031 sudah sukses; CSV diagnosa 2026-11-02 masih sesuai database.
-- WAJIB backup Supabase; hentikan Counting / Upload / approval selama eksekusi.
-- Jika guard gagal, tidak ada perubahan inventory / BA / SO / backup / audit.
-- Pilih satu SQL ini; jangan menjalankan SQL 032 lama secara terpisah.

-- MIGRASI 032: Nama Item satu-satunya identitas bisnis inventory/SO/BA.
-- Internal kolom sku dipertahankan untuk kompatibilitas RPC, namun nilainya berubah
-- menjadi UPPER(TRIM(Nama Item, spasi tunggal)), BUKAN kode SKU asli.
-- Memperbarui BA historis yang detailnya masih ada, termasuk BA signed/exported.
-- Tidak mengubah qty, biaya, tanggal, tanda tangan, atau status SO/BA.
-- Backup database dahulu; hentikan upload dan counting selama migrasi.
BEGIN;
SET LOCAL lock_timeout='15s';

-- ================= PERBAIKAN DUPLIKAT 032 (ATOMIC) =================
-- Berdasarkan export Supabase: 11 pasangan (22 baris), seluruh ending=0.
-- Tidak menggabungkan Qty, tidak menyentuh tsi_so_lines/BA pada tahap ini.
-- Jika isi database sudah berubah, seluruh transaksi dibatalkan.
-- Baris yang dikeluarkan dicadangkan sebelum perubahan.

LOCK TABLE public.tsi_so_inventory IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE _nm032_expected(store_code text,name_key text) ON COMMIT DROP;
INSERT INTO _nm032_expected(store_code,name_key) VALUES
 ('TPK-PLU','M 4 SUPER 1 LITER'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PDK 2XL'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PDK L'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PDK M'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PDK S'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PDK XL'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PJG 2XL'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PJG L'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PJG M'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PJG S'),
 ('TPK-TRJ','KEMEJA FORMAL STEEL BLUE PJG XL');

CREATE TEMP TABLE _nm032_candidates ON COMMIT DROP AS
SELECT i.store_code, i.sku old_sku, i.item_name, i.category, i.ending,
 i.cost, i.retail_price, i.upload_id, i.updated_at,
 n.name_key, to_jsonb(i) AS full_row,
 count(*) OVER(PARTITION BY i.store_code,n.name_key) AS group_size,
 row_number() OVER(PARTITION BY i.store_code,n.name_key
     ORDER BY CASE WHEN i.item_name=n.name_key THEN 0 ELSE 1 END,
       CASE WHEN i.sku<>n.name_key THEN 0 ELSE 1 END,i.sku) AS row_no
FROM public.tsi_so_inventory i
CROSS JOIN LATERAL (
 SELECT upper(regexp_replace(btrim(coalesce(i.item_name,'')), '[[:space:]]+', ' ', 'g')) name_key
) n
JOIN _nm032_expected e ON e.store_code=i.store_code AND e.name_key=n.name_key;

DO $dedup_guard$ DECLARE v_problem text; v_n integer; BEGIN
 SELECT count(*) INTO v_n FROM _nm032_candidates;
 IF v_n<>22 THEN RAISE EXCEPTION '032 revisi: data duplikat berubah (seharusnya 22 baris, aktual %). Jalankan diagnosa ulang.', v_n; END IF;

 SELECT c.store_code||' | '||c.name_key INTO v_problem
 FROM _nm032_candidates c
 GROUP BY c.store_code,c.name_key
 HAVING count(*)<>2
    OR count(*) FILTER (WHERE c.group_size=2)<>2
    OR count(*) FILTER (WHERE c.item_name=c.name_key)<>1
    OR count(DISTINCT c.category)<>1
    OR count(DISTINCT c.upload_id)<>1
    OR count(DISTINCT c.cost)<>1
    OR count(DISTINCT c.retail_price)<>1
    OR count(*) FILTER (WHERE c.ending=0)<>2
 LIMIT 1;
 IF v_problem IS NOT NULL THEN
  RAISE EXCEPTION '032 revisi: data tidak lagi identik pada %, periksa manual. Tidak ada perubahan.',v_problem;
 END IF;

 -- Cek kelompok benturan lain yang tidak termasuk 11 baris referensi.
 SELECT d.store_code||' | '||d.name_key INTO v_problem FROM (
 SELECT i.store_code,
  upper(regexp_replace(btrim(coalesce(i.item_name,'')), '[[:space:]]+', ' ', 'g')) name_key
 FROM public.tsi_so_inventory i
 GROUP BY i.store_code,upper(regexp_replace(btrim(coalesce(i.item_name,'')), '[[:space:]]+', ' ', 'g'))
 HAVING count(*)>1
 ) d LEFT JOIN _nm032_expected e ON e.store_code=d.store_code AND e.name_key=d.name_key
 WHERE e.store_code IS NULL LIMIT 1;
 IF v_problem IS NOT NULL THEN
  RAISE EXCEPTION '032 revisi: muncul duplikasi baru pada %. Jalankan diagnosa ulang.',v_problem;
 END IF;
END $dedup_guard$;

-- Backup khusus baris inventory yang dikeluarkan; tidak memuat credential.
CREATE TABLE IF NOT EXISTS public.tsi_so_inventory_dedup_backup_032 (
 store_code text NOT NULL,
 old_sku text NOT NULL,
 name_key text NOT NULL,
 full_row jsonb NOT NULL,
 backed_up_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(store_code,old_sku)
);
ALTER TABLE public.tsi_so_inventory_dedup_backup_032 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tsi_so_inventory_dedup_backup_032 FROM PUBLIC,anon,authenticated;

INSERT INTO public.tsi_so_inventory_dedup_backup_032(store_code,old_sku,name_key,full_row)
SELECT store_code,old_sku,name_key,full_row FROM _nm032_candidates WHERE row_no=2;

-- Simpan alias lama di TEMP table agar BA dan riwayat scope juga termigrasi.
CREATE TEMP TABLE _nm032_removed_alias ON COMMIT DROP AS
SELECT store_code, old_sku, name_key FROM _nm032_candidates WHERE row_no=2;
CREATE UNIQUE INDEX ON _nm032_removed_alias(store_code,old_sku);

DO $dedup_delete$ DECLARE v_deleted integer; BEGIN
 DELETE FROM public.tsi_so_inventory i
 USING _nm032_removed_alias r
 WHERE i.store_code=r.store_code AND i.sku=r.old_sku;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 IF v_deleted<>11 THEN
  RAISE EXCEPTION '032 revisi: pengurangan inventory tidak sesuai (%, semestinya 11). Semua perubahan dibatalkan.',v_deleted;
 END IF;
END $dedup_delete$;

INSERT INTO public.tsi_so_audit(user_id,store_code,event,meta)
SELECT NULL,c.store_code,'ITEM_NAME_DUPLICATE_RESOLVED_032',
 jsonb_build_object('kept_sku_before_032',max(c.old_sku) FILTER(WHERE c.row_no=1),
  'removed_sku_before_032',max(c.old_sku) FILTER(WHERE c.row_no=2),
  'name_key',c.name_key,'removed_ending',0,'note','Backup di tsi_so_inventory_dedup_backup_032')
FROM _nm032_candidates c GROUP BY c.store_code,c.name_key;
-- ================= AKHIR PERBAIKAN DUPLIKAT =================


DO $required$ BEGIN
 IF to_regprocedure('public.tsi_so_upload(text,jsonb)') IS NULL OR
    to_regclass('public.tsi_so_ba') IS NULL OR
    to_regclass('public.tsi_so_sku_rounds') IS NULL OR
    to_regprocedure('public.tsi_so_upload_rewrite_scope_fast(jsonb)') IS NULL OR
    to_regclass('public.tsi_so_item_sku_map') IS NULL THEN
  RAISE EXCEPTION 'Pasang migrasi hingga 031 sebelum 032.';
 END IF;
END $required$;

CREATE OR REPLACE FUNCTION public.tsi_so_name_key(p_name text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 SELECT upper(regexp_replace(btrim(coalesce(p_name,'')),'[[:space:]]+',' ','g'))
$$;
REVOKE ALL ON FUNCTION public.tsi_so_name_key(text) FROM PUBLIC,anon,authenticated;

-- 1. Rancang alias semua identitas terdahulu tanpa menyentuh data.
CREATE TEMP TABLE _nm032_source ON COMMIT DROP AS
 SELECT i.store_code, i.sku AS old_sku, public.tsi_so_name_key(i.item_name) AS new_key
 FROM public.tsi_so_inventory i
 UNION ALL
 SELECT c.store_code, l.sku, public.tsi_so_name_key(l.item_name)
 FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
 UNION ALL
 SELECT r.store_code, r.old_sku, r.name_key FROM _nm032_removed_alias r;
CREATE INDEX ON _nm032_source(store_code,old_sku);

DO $guard$ DECLARE conflict text; BEGIN
 SELECT store_code||' | '||old_sku INTO conflict FROM _nm032_source
 GROUP BY store_code,old_sku HAVING count(DISTINCT new_key)>1 LIMIT 1;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Kode lama terhubung ke Nama Item berbeda: %. Migrasi dibatalkan.',conflict; END IF;
 SELECT store_code||' | '||new_key INTO conflict FROM (
  SELECT store_code,new_key,count(*) q FROM public.tsi_so_inventory i
  CROSS JOIN LATERAL (SELECT public.tsi_so_name_key(i.item_name) new_key) k
  GROUP BY store_code,new_key HAVING count(*)>1 LIMIT 1
 ) z;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Nama Item ganda dalam Inventory: %. Rapikan nama sebelum lanjut.',conflict; END IF;
 SELECT cycle_id::text||' | '||new_key INTO conflict FROM (
  SELECT cycle_id,public.tsi_so_name_key(item_name) new_key FROM public.tsi_so_lines
 ) x GROUP BY cycle_id,new_key HAVING count(*)>1 LIMIT 1;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Nama Item ganda dalam SO: %. Migrasi dibatalkan.',conflict; END IF;
 SELECT l.id::text INTO conflict FROM public.tsi_so_lines l
 WHERE public.tsi_so_name_key(l.item_name)='' LIMIT 1;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Ada Nama Item kosong pada detail SO (ID %).',conflict; END IF;
 SELECT i.store_code||':'||i.sku INTO conflict FROM public.tsi_so_inventory i
 WHERE public.tsi_so_name_key(i.item_name)='' LIMIT 1;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Ada Nama Item kosong pada inventory (toko/item %).',conflict; END IF;
END $guard$;

CREATE TEMP TABLE _nm032_map ON COMMIT DROP AS
 SELECT store_code,old_sku,max(new_key) new_key
 FROM _nm032_source GROUP BY store_code,old_sku;
CREATE UNIQUE INDEX ON _nm032_map(store_code,old_sku);
CREATE INDEX ON _nm032_map(store_code,new_key);
-- Rasio SO historis yang tidak lagi ada pada inventory/detail dicocokkan dengan master
-- jika tersedia. Key tanpa pasangan tetap disimpan (tidak dihapus) demi audit.
INSERT INTO _nm032_map(store_code,old_sku,new_key)
SELECT r.store_code,r.sku,public.tsi_so_name_key(m.item_name)
FROM public.tsi_so_sku_rounds r
JOIN public.tsi_so_item_sku_map m ON m.official_sku=r.sku
WHERE NOT EXISTS(SELECT 1 FROM _nm032_map z WHERE z.store_code=r.store_code AND z.old_sku=r.sku)
ON CONFLICT(store_code,old_sku) DO NOTHING;

DO $round_guard$ DECLARE conflict text; BEGIN
 SELECT store_code||' | '||new_key INTO conflict FROM (
 SELECT r.store_code,coalesce(m.new_key,r.sku) new_key,count(*) q
 FROM public.tsi_so_sku_rounds r LEFT JOIN _nm032_map m ON m.store_code=r.store_code AND m.old_sku=r.sku
 GROUP BY r.store_code,coalesce(m.new_key,r.sku) HAVING count(*)>1 LIMIT 1
 ) t;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Konflik rasio SO untuk Nama Item %. Perbaiki sebelum migrasi.', conflict; END IF;
END $round_guard$;

-- Validasi: jangan gabungkan dua alasan lama menjadi satu key Nama Item di BA.
DO $ba_guard$ DECLARE conflict text; BEGIN
 SELECT b.ba_no INTO conflict FROM public.tsi_so_ba b
 CROSS JOIN LATERAL jsonb_each(coalesce(b.reason_overrides,'{}'::jsonb)) e
 LEFT JOIN _nm032_map m ON m.store_code=b.store_code AND m.old_sku=e.key
 GROUP BY b.ba_no,coalesce(m.new_key,e.key) HAVING count(*)>1 LIMIT 1;
 IF conflict IS NOT NULL THEN RAISE EXCEPTION 'Konflik alasan pada BA %; migrasi dibatalkan.',conflict; END IF;
END $ba_guard$;

-- 2. Alasan BA dipindah kuncinya SEBELUM detail SO berubah.
-- Agar nilai alasan dan tanda tangan BA lama tetap sama.
UPDATE public.tsi_so_ba b SET reason_overrides=(
 SELECT coalesce(jsonb_object_agg(coalesce(m.new_key,e.key),e.value),'{}'::jsonb)
 FROM jsonb_each(coalesce(b.reason_overrides,'{}'::jsonb)) e
 LEFT JOIN _nm032_map m ON m.store_code=b.store_code AND m.old_sku=e.key
)
WHERE b.reason_overrides<>'{}'::jsonb;

-- 3. Update key inventory/detail/rasio dengan placeholder yang tidak berbenturan.
-- Dua tahap diperlukan karena UNIQUE (store,sku) dan (cycle,sku).
UPDATE public.tsi_so_inventory i SET sku='__NM032_'||md5(i.store_code||':'||i.sku)
WHERE i.sku<>public.tsi_so_name_key(i.item_name);
UPDATE public.tsi_so_inventory i SET sku=public.tsi_so_name_key(i.item_name)
WHERE i.sku LIKE '__NM032_%';

UPDATE public.tsi_so_lines l SET sku='__NM032_'||md5(l.id::text)
WHERE l.sku<>public.tsi_so_name_key(l.item_name);
UPDATE public.tsi_so_lines l SET sku=public.tsi_so_name_key(l.item_name)
WHERE l.sku LIKE '__NM032_%';

UPDATE public.tsi_so_sku_rounds r SET sku='__NM032_'||md5(r.store_code||':'||r.sku)
FROM _nm032_map m WHERE r.store_code=m.store_code AND r.sku=m.old_sku AND r.sku<>m.new_key;
-- old key placeholder di atas dicocokkan kembali dari hash old code.
UPDATE public.tsi_so_sku_rounds r SET sku=m.new_key
FROM _nm032_map m
WHERE r.store_code=m.store_code AND r.sku='__NM032_'||md5(m.store_code||':'||m.old_sku);

-- 4. Perbaiki scope tersimpan per toko: alias tidak boleh tercampur antar toko.
DO $scope$ DECLARE v_store text; BEGIN
 CREATE TEMP TABLE pg_temp._up031_alias(alias_key text PRIMARY KEY,sku text NOT NULL) ON COMMIT DROP;
 FOR v_store IN SELECT code FROM public.tsi_so_stores LOOP
  TRUNCATE TABLE pg_temp._up031_alias;
  INSERT INTO pg_temp._up031_alias(alias_key,sku)
  SELECT upper(btrim(old_sku)),new_key FROM _nm032_map
  WHERE store_code=v_store ORDER BY old_sku ON CONFLICT(alias_key) DO NOTHING;
  INSERT INTO pg_temp._up031_alias(alias_key,sku)
  SELECT new_key,new_key FROM _nm032_map WHERE store_code=v_store
  ORDER BY new_key ON CONFLICT(alias_key) DO NOTHING;
  UPDATE public.tsi_so_cycles c SET
    scope_skus=public.tsi_so_upload_rewrite_scope_fast(c.scope_skus),
    scope_rule=CASE WHEN jsonb_typeof(c.scope_rule)='object' AND c.scope_rule ? 'skus'
     THEN jsonb_set(c.scope_rule,'{skus}',coalesce(public.tsi_so_upload_rewrite_scope_fast(c.scope_rule->'skus'),'[]'::jsonb),true)
     ELSE c.scope_rule END,
    team_map=CASE WHEN jsonb_typeof(c.team_map)='array'
     THEN (SELECT coalesce(jsonb_agg(
      CASE WHEN jsonb_typeof(z.t->'rule')='object' AND (z.t->'rule') ? 'skus'
       THEN jsonb_set(z.t,'{rule,skus}',coalesce(public.tsi_so_upload_rewrite_scope_fast(z.t->'rule'->'skus'),'[]'::jsonb),true)
       ELSE z.t END ORDER BY z.ord),'[]'::jsonb)
       FROM jsonb_array_elements(c.team_map) WITH ORDINALITY z(t,ord))
      ELSE c.team_map END
  WHERE c.store_code=v_store AND
   (c.scope_skus IS NOT NULL OR c.scope_rule IS NOT NULL OR c.team_map IS NOT NULL);
 END LOOP;
END $scope$;

INSERT INTO public.tsi_so_audit(user_id,store_code,event,meta)
SELECT null, store_code,'ITEM_NAME_BASELINE_032',
 jsonb_build_object('jumlah_kode_terpetakan',count(*),'identity','normalized_item_name',
 'catatan','BA lama menampilkan Nama Item saat diunduh ulang; dokumen HTML lama tidak berubah otomatis.')
FROM _nm032_map GROUP BY store_code;

-- 5. Upload baru: file CSV tidak perlu SKU dan tidak perlu Item Library.
CREATE OR REPLACE FUNCTION public.tsi_so_upload_prepare(p_store text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_count int; v_bad int; v_out jsonb; v_duplicate text; role text;
BEGIN
 role:=public.tsi_so_authorize(p_store,true);
 IF role NOT IN ('store','admin','spv') THEN RAISE EXCEPTION 'Tidak memiliki akses upload.'; END IF;
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Format inventory harus array.'; END IF;
 v_count:=jsonb_array_length(p_rows);
 IF v_count NOT BETWEEN 1 AND 10000 THEN RAISE EXCEPTION 'Upload 1–10000 item per file.'; END IF;
 SELECT count(*) INTO v_bad FROM jsonb_array_elements(p_rows) j
 WHERE length(btrim(coalesce(j->>'name',''))) NOT BETWEEN 1 AND 250
   OR coalesce(j->>'ending','') !~ '^[0-9]{1,12}$'
   OR coalesce(nullif(j->>'cost',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
   OR coalesce(nullif(j->>'retail',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
 IF v_bad>0 THEN RAISE EXCEPTION '% baris memiliki Nama Item / Qty / biaya tidak valid.',v_bad; END IF;
 SELECT public.tsi_so_name_key(j->>'name') INTO v_duplicate
 FROM jsonb_array_elements(p_rows) j
 GROUP BY public.tsi_so_name_key(j->>'name') HAVING count(*)>1 LIMIT 1;
 IF v_duplicate IS NOT NULL THEN RAISE EXCEPTION 'Nama Item duplikat: %. Upload dibatalkan.',v_duplicate; END IF;
 SELECT coalesce(jsonb_agg(
   (j - 'sku') || jsonb_build_object('sku',public.tsi_so_name_key(j->>'name'), '_sku_source','name_only')
 ORDER BY ord),'[]'::jsonb) INTO v_out
 FROM jsonb_array_elements(p_rows) WITH ORDINALITY z(j,ord);
 RETURN v_out;
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_upload_prepare(text,jsonb) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.tsi_so_upload_check(p_store text,p_rows jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE v_rows jsonb;
BEGIN
 v_rows:=public.tsi_so_upload_prepare(p_store,p_rows);
 RETURN jsonb_build_object('total',jsonb_array_length(v_rows),'identity','item_name');
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_upload_check(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_upload_check(text,jsonb) TO authenticated;

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
 SELECT count(*),0 INTO v_matched,v_pending FROM pg_temp._up031_stage;

 -- Nama Item adalah identitas: izinkan migrasi kode lama ke nama di SO aktif.
 SELECT x.final_sku INTO v_conflict FROM (
  SELECT l.cycle_id,coalesce(s.sku,l.sku) final_sku,count(*) qty
  FROM public.tsi_so_lines l JOIN public.tsi_so_cycles c ON c.id=l.cycle_id
  LEFT JOIN pg_temp._up031_stage s
   ON s.name_key=upper(regexp_replace(btrim(l.item_name),'[[:space:]]+',' ','g'))
  WHERE c.store_code=p_store AND c.status IN ('COUNTING','RECOUNT')
  GROUP BY l.cycle_id,coalesce(s.sku,l.sku) HAVING count(*)>1 LIMIT 1
 ) x;
 IF v_conflict IS NOT NULL THEN
  RAISE EXCEPTION 'Nama Item % ganda pada SO aktif. Tidak ada data yang diubah.',v_conflict;
 END IF;

 -- Akses hanya ke toko yang dipilih; identitas Nama Item pada data baru.
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
;
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
 'identity','item_name',
 'active_so_sku_converted',v_fixed,'synced_lines',v_synced,'locked_lines',v_locked,
 'upload_optimization','031-indexed-staging'));
 RETURN jsonb_build_object('upload_id',v_id,'sku_count',v_count,'identity','item_name','active_so_sku_converted',v_fixed,'synced_lines',v_synced,
 'locked_lines',v_locked);
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_upload(text,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_upload(text,jsonb) TO authenticated;


-- 6. Cakupan SO berdasar Nama Item tanpa indikator kode resmi.
CREATE OR REPLACE FUNCTION public.tsi_so_sku_coverage(
 p_store text,p_filter text DEFAULT 'ALL',p_search text DEFAULT '',
 p_offset integer DEFAULT 0,p_limit integer DEFAULT 50
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
 PERFORM public.tsi_so_authorize(p_store,true);
 IF p_filter IS NULL OR p_filter NOT IN ('ALL','BELUM','SUDAH','DIPILIH','TERKUNCI') THEN
   RAISE EXCEPTION 'Filter cakupan tidak dikenal.'; END IF;
 IF p_offset<0 OR p_limit NOT BETWEEN 1 AND 100 OR length(coalesce(p_search,''))>120 THEN
   RAISE EXCEPTION 'Parameter pencarian/paginasi salah.'; END IF;
 WITH base AS MATERIALIZED (
  SELECT sku,item_name,category,so_count FROM public.tsi_so_rounds(p_store)
 ), low AS (SELECT coalesce(min(so_count),0) mn FROM base),
 summary AS (
 SELECT jsonb_build_object('total',count(b.sku),'belum',count(*) FILTER(WHERE b.so_count=0),
   'sudah',count(*) FILTER(WHERE b.so_count>0),
   'dipilih',count(*) FILTER(WHERE b.so_count=low.mn),
   'terkunci',count(*) FILTER(WHERE b.so_count>low.mn),
   'min_ratio',low.mn,'max_ratio',coalesce(max(b.so_count),0)) AS val
 FROM low LEFT JOIN base b ON true GROUP BY low.mn
 ), filtered AS MATERIALIZED (
  SELECT b.* FROM base b CROSS JOIN low
  WHERE (coalesce(p_search,'')='' OR b.item_name ILIKE '%'||p_search||'%')
   AND (p_filter='ALL' OR (p_filter='BELUM' AND b.so_count=0) OR
   (p_filter='SUDAH' AND b.so_count>0) OR (p_filter='DIPILIH' AND b.so_count=low.mn)
   OR (p_filter='TERKUNCI' AND b.so_count>low.mn))
 ), pg AS (SELECT * FROM filtered ORDER BY item_name LIMIT p_limit OFFSET p_offset)
 SELECT jsonb_build_object('summary',(SELECT val FROM summary),
  'total_filtered',(SELECT count(*) FROM filtered),
  'items',coalesce((SELECT jsonb_agg(jsonb_build_object('sku',sku,'name',item_name,
    'category',category,'ratio',so_count,'eligible',so_count=(SELECT mn FROM low),
    'status',CASE WHEN so_count=0 THEN 'BELUM' ELSE 'SUDAH' END) ORDER BY item_name) FROM pg),'[]'::jsonb))
 INTO result;
 RETURN result;
END; $fn$;
REVOKE ALL ON FUNCTION public.tsi_so_sku_coverage(text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_sku_coverage(text,text,text,integer,integer) TO authenticated;

-- 7. Penyempurnaan pembacaan warna dari Nama Item. Hanya label kategori/warna,
--    tidak mengubah nama item maupun data counting.
CREATE OR REPLACE FUNCTION public.tsi_so_color_name(p_name text,p_category text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
 WITH x AS (SELECT upper(btrim(coalesce(p_name,''))) n, upper(btrim(coalesce(p_category,''))) c),
 y AS (SELECT CASE
     WHEN x.n ~ '^.*?\s+[0-9]+S(\s|$)' THEN substring(x.n from '^(.*?)\s+[0-9]+S(\s|$)')
     WHEN x.c<>'' AND starts_with(x.n,x.c||' ') THEN substr(x.n,length(x.c)+2)
     ELSE x.n END v FROM x),
 z AS (SELECT btrim(regexp_replace(' '||y.v,
    '(\s+(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ALL\s?SIZE|FREE\s?SIZE|[0-9]{1,3}))+$','','g')) v FROM y),
 d AS (SELECT regexp_replace(z.v,'^(DEFECT\s+[ABC]([0-9]+(-[0-9]+)?)?\s+|REJECT\s+)','','i') v FROM z),
 e AS (SELECT btrim(regexp_replace(d.v,
    '\s+(\+\s*RIB|KID|KIDS|PDK|PJG|TUNIK|OS|MAMU)(\s+(KID|KIDS|PDK|PJG|MAMU))?$','','i')) v FROM d)
 SELECT coalesce(nullif(btrim(e.v),''),'TANPA WARNA') FROM e
$$;

COMMIT;
