-- Pemeriksaan ringan; tidak memuat semua isi workbook.
select revision,
 (select count(*) from public.native_sheet) as jumlah_tab,
 (select coalesce(sum(greatest(jsonb_array_length(payload->'rows')-1,0)),0) from public.native_sheet) as jumlah_baris_data
from public.native_state where id=true;

select name,greatest(jsonb_array_length(payload->'rows')-1,0) as jumlah_baris_data
from public.native_sheet where name in ('MASTER_STORE','MASTER_SKU','USERS','SO_HEADER','SO_DETAIL') order by name;
