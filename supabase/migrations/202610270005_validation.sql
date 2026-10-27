-- Validasi SPV: ringkasan angka (total, variance, akurasi, blokir Approve) dan filter Hanya Variance.
-- Jalankan SETELAH 202610270004_schedule.sql. Aman dijalankan ulang.

drop function if exists public.tsi_so_validation_page(uuid,integer,integer,text);

create or replace function public.tsi_so_validation_page(p_cycle uuid,p_offset integer default 0,p_limit integer default 50,p_search text default '',p_filter text default 'ALL')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; body jsonb; n integer; sm jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'Pagination salah.'; end if;
 if p_filter not in ('ALL','VARIANCE') then raise exception 'Filter tidak sah.'; end if;

 select count(*) into n from public.tsi_so_lines l where l.cycle_id=p_cycle
  and (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%')
  and (p_filter='ALL' or (l.warehouse_qty is not null and l.display_qty is not null
       and coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start));

 select jsonb_build_object(
  'total_skus',count(*),
  'missing_skus',count(*) filter(where l.warehouse_qty is null or l.display_qty is null),
  'variance_skus',count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null
       and coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start),
  'tally_skus',count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null
       and coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)=l.system_at_start),
  'blocking_skus',count(*) filter(where l.warehouse_qty is null or l.display_qty is null or
       (coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start
        and trim(l.spv_note)='' and trim(l.store_note)='')))
 into sm from public.tsi_so_lines l where l.cycle_id=p_cycle;

 select coalesce(jsonb_agg(jsonb_build_object('sku',l.sku,'name',l.item_name,'category',l.category,
 'system_at_start',l.system_at_start,'latest_system',inv.ending,'warehouse',l.warehouse_qty,'display',l.display_qty,
 'actual',case when l.warehouse_qty is null or l.display_qty is null then null else l.warehouse_qty+l.display_qty end,
 'validated_qty',l.validated_qty,'store_note',l.store_note,'spv_note',l.spv_note,'cost',l.unit_cost,
 'delta',coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start) order by l.sku),'[]'::jsonb) into body
 from (select * from public.tsi_so_lines l where l.cycle_id=p_cycle
  and (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%')
  and (p_filter='ALL' or (l.warehouse_qty is not null and l.display_qty is not null
       and coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start))
  order by l.sku limit p_limit offset p_offset) l
 left join public.tsi_so_inventory inv on inv.store_code=c.store_code and inv.sku=l.sku;

 return jsonb_build_object('status',c.status,'store_code',c.store_code,'cycle_id',c.id,
  'total_filtered',n,'summary',sm,'items',body);
end;$$;

revoke all on function public.tsi_so_validation_page(uuid,integer,integer,text,text) from public, anon;
grant execute on function public.tsi_so_validation_page(uuid,integer,integer,text,text) to authenticated;
