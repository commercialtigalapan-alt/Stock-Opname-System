-- 030: Jumlah SKU resmi dan belum resmi pada menu Cakupan SKU.
-- Gunakan sumber Inventory AKTIF per toko (tsi_so_rounds) dan master resmi
-- Item Library (tsi_so_item_sku_map), bukan seluruh 7.295 baris library.
-- Perhitungan SO dan status kelayakan SKU tetap seperti migrasi 005.
-- Tidak ada operasi INSERT/UPDATE/DELETE atas data inventory, SO, dan BA.
-- Jalankan setelah migrasi 026 dan 029.
BEGIN;
DO $require_master$ BEGIN
 IF to_regclass('public.tsi_so_item_sku_map') IS NULL THEN
  RAISE EXCEPTION 'Migrasi 026 belum dijalankan: master SKU resmi tidak tersedia.';
 END IF;
END $require_master$;

CREATE OR REPLACE FUNCTION public.tsi_so_sku_coverage(
 p_store text, p_filter text DEFAULT 'ALL', p_search text DEFAULT '',
 p_offset integer DEFAULT 0, p_limit integer DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE body jsonb;
BEGIN
 PERFORM public.tsi_so_authorize(p_store,true);
 IF p_filter IS NULL OR p_filter NOT IN
   ('ALL','BELUM','SUDAH','DIPILIH','TERKUNCI','RESMI','BELUM_RESMI') THEN
  RAISE EXCEPTION 'Filter Cakupan SKU tidak sah.';
 END IF;
 IF p_offset IS NULL OR p_limit IS NULL OR p_offset < 0 OR p_limit NOT BETWEEN 1 AND 100 THEN
  RAISE EXCEPTION 'Pagination salah.';
 END IF;
 IF p_search IS NULL OR length(p_search)>120 THEN
  RAISE EXCEPTION 'Pencarian tidak sah atau terlalu panjang.';
 END IF;

 WITH base AS MATERIALIZED (
  SELECT e.sku,e.item_name,e.category,e.so_count,
     EXISTS (
      SELECT 1 FROM public.tsi_so_item_sku_map m
      WHERE m.official_sku = upper(btrim(e.sku))
     ) AS sku_official
  FROM public.tsi_so_rounds(p_store) e
 ), low AS (
  SELECT COALESCE(MIN(so_count),0) AS mn FROM base
 ), summary AS (
  SELECT jsonb_build_object(
    'total',count(b.sku),
    'belum',count(*) FILTER (WHERE b.so_count=0),
    'sudah',count(*) FILTER (WHERE b.so_count>0),
    'dipilih',count(*) FILTER (WHERE b.so_count=low.mn),
    'terkunci',count(*) FILTER (WHERE b.so_count>low.mn),
    'min_ratio',low.mn,
    'max_ratio',COALESCE(MAX(b.so_count),0),
    'resmi',count(*) FILTER (WHERE b.sku_official),
    'belum_resmi',count(*) FILTER (WHERE NOT b.sku_official)
   ) AS val
  FROM low LEFT JOIN base b ON true
  GROUP BY low.mn
 ), filtered AS MATERIALIZED (
  SELECT b.* FROM base b CROSS JOIN low
  WHERE (p_search='' OR b.sku ILIKE '%'||p_search||'%'
    OR b.item_name ILIKE '%'||p_search||'%')
    AND (p_filter='ALL'
       OR (p_filter='BELUM' AND b.so_count=0)
       OR (p_filter='SUDAH' AND b.so_count>0)
       OR (p_filter='DIPILIH' AND b.so_count=low.mn)
       OR (p_filter='TERKUNCI' AND b.so_count>low.mn)
       OR (p_filter='RESMI' AND b.sku_official)
       OR (p_filter='BELUM_RESMI' AND NOT b.sku_official))
 ), page AS (
  SELECT * FROM filtered ORDER BY sku LIMIT p_limit OFFSET p_offset
 )
 SELECT jsonb_build_object(
   'summary',(SELECT val FROM summary),
   'total_filtered',(SELECT COUNT(*) FROM filtered),
   'items',COALESCE((
     SELECT jsonb_agg(jsonb_build_object(
       'sku',sku,'name',item_name,'category',category,'ratio',so_count,
       'eligible',so_count=(SELECT mn FROM low),
       'status',CASE WHEN so_count=0 THEN 'BELUM' ELSE 'SUDAH' END,
       'sku_official',sku_official
     ) ORDER BY sku) FROM page
   ),'[]'::jsonb)
 ) INTO body;
 RETURN body;
END;$$;

REVOKE ALL ON FUNCTION public.tsi_so_sku_coverage(text,text,text,integer,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.tsi_so_sku_coverage(text,text,text,integer,integer) TO authenticated;
COMMIT;
