-- Akurasi dashboard hanya dihitung dari SO yang sudah APPROVED (sesuai v164, V156).
-- Jalankan SETELAH 202610270008_submit_message.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_dashboard()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; arr jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object(
 'code',s.code,'name',s.name,'area',s.area,
 'status',coalesce(c.status,'BELUM SO'),'cycle_id',c.id,
 'archived',c.archived_at is not null,
 'total',st.total,'done',st.done,
 'inventory_count',(select count(*) from public.tsi_so_inventory inv where inv.store_code=s.code),
 'tally',case when c.status in ('SUBMITTED','APPROVED') then st.tally else null end,
 'variance',case when c.status in ('SUBMITTED','APPROVED') then st.variance else null end,
 'accuracy',case when u.role in ('spv','admin') and c.status='APPROVED' and st.total>0 then round(st.tally::numeric/st.total,4) else null end,
 'qty_accuracy',case when u.role in ('spv','admin') and c.status='APPROVED' and st.total>0 then
   case when st.sys_qty=0 then case when st.abs_qty_diff=0 then 1 else 0 end
   else round(greatest(0,1-st.abs_qty_diff/st.sys_qty),4) end else null end,
 'value_accuracy',case when u.role in ('spv','admin') and c.status='APPROVED' and st.sys_value>0 then
   round(greatest(0,1-st.abs_value_diff/st.sys_value),4) else null end,
 'started_at',c.started_at) order by s.name),'[]'::jsonb) into arr
 from public.tsi_so_stores s
 left join lateral (select * from public.tsi_so_cycles x where x.store_code=s.code order by x.started_at desc,x.id desc limit 1) c on true
 left join lateral (
  select
   case when c.archived_at is not null then c.total_skus else x.total end total,
   case when c.archived_at is not null then c.total_skus else x.done end done,
   case when c.archived_at is not null then c.tally_count else x.tally end tally,
   case when c.archived_at is not null then c.variance_count else x.variance end variance,
   case when c.archived_at is not null then c.sys_qty else x.sys_qty end sys_qty,
   case when c.archived_at is not null then c.abs_qty_diff else x.abs_qty_diff end abs_qty_diff,
   case when c.archived_at is not null then c.sys_value else x.sys_value end sys_value,
   case when c.archived_at is not null then c.abs_value_diff else x.abs_value_diff end abs_value_diff
  from (select count(*) total,
   count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null) done,
   count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null and
        coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)=l.system_at_start) tally,
   count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null and
        coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start) variance,
   sum(l.system_at_start)::numeric sys_qty,
   sum(abs(coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start))::numeric abs_qty_diff,
   sum(l.system_at_start*l.unit_cost)::numeric sys_value,
   sum(abs(coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start)*l.unit_cost)::numeric abs_value_diff
  from public.tsi_so_lines l where l.cycle_id=c.id) x
 ) st on true
 where s.active and (u.role='admin' or (u.role='store' and s.code=u.store_code) or
 (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=s.code)));
 return jsonb_build_object('role',u.role,'stores',arr);
end;$$;

revoke all on function public.tsi_so_dashboard() from public, anon;
grant execute on function public.tsi_so_dashboard() to authenticated;
