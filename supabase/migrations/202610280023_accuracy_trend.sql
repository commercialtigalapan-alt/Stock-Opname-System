-- Tren akurasi per toko per periode (harian/mingguan/bulanan/tahunan) untuk grafik Dashboard.
-- Rumus mengikuti tsi_so_kpi: hanya SO APPROVED (atau sudah diarsipkan), cakupan role sama.
-- Dikelompokkan per toko dan periode; filter area/toko dilakukan di frontend memakai data analitik toko.
-- Jalankan SETELAH 202610280006_user_names_upload_history.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_accuracy_trend(p_type text default null, p_from date default null,
  p_to date default null, p_bucket text default 'week')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; body jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 if p_type is not null and p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 if p_bucket not in ('day','week','month','year') then raise exception 'Periode tidak sah.'; end if;

 with cyc as (
  select c.id, c.store_code, c.archived_at, c.total_skus, c.tally_count, c.sys_qty, c.abs_qty_diff,
    c.sys_value, c.abs_value_diff,
    date_trunc(p_bucket, coalesce(c.planned_date,c.started_at::date)::timestamp)::date bkt
  from public.tsi_so_cycles c
  where (c.status='APPROVED' or c.archived_at is not null)
   and (p_type is null or c.so_type=p_type)
   and (p_from is null or coalesce(c.planned_date,c.started_at::date)>=p_from)
   and (p_to is null or coalesce(c.planned_date,c.started_at::date)<=p_to)
   and (u.role='admin' or (u.role='store' and c.store_code=u.store_code)
    or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=c.store_code)))
 ), m as (
  select cy.id, cy.store_code, cy.bkt,
   case when cy.archived_at is not null then coalesce(cy.total_skus,0) else x.total end total,
   case when cy.archived_at is not null then coalesce(cy.tally_count,0) else x.tally end tally,
   case when cy.archived_at is not null then coalesce(cy.sys_qty,0) else x.sys_qty end sys_qty,
   case when cy.archived_at is not null then coalesce(cy.abs_qty_diff,0) else x.abs_qty end abs_qty,
   case when cy.archived_at is not null then coalesce(cy.sys_value,0) else x.sys_value end sys_value,
   case when cy.archived_at is not null then coalesce(cy.abs_value_diff,0) else x.abs_value end abs_value
  from cyc cy
  left join lateral (
   select count(*) total, count(*) filter(where z.a=z.s) tally,
    coalesce(sum(z.s),0)::numeric sys_qty, coalesce(sum(abs(z.a-z.s)),0)::numeric abs_qty,
    coalesce(sum(z.s*z.c),0)::numeric sys_value, coalesce(sum(abs(z.a-z.s)*z.c),0)::numeric abs_value
   from (select l.system_at_start s, l.unit_cost c,
     case when public.tsi_so_actual(l) is not null then coalesce(l.validated_qty,public.tsi_so_actual(l)) end a
     from public.tsi_so_lines l where l.cycle_id=cy.id) z
  ) x on true
 )
 select coalesce(jsonb_agg(jsonb_build_object('store_code',g.store_code,'bucket',g.bkt,'so_approved',g.so_n,
   'appr_total',g.total,'appr_tally',g.tally,'appr_sys_qty',g.sys_qty,'appr_abs_qty',g.abs_qty,
   'appr_sys_value',g.sys_value,'appr_abs_value',g.abs_value) order by g.bkt,g.store_code),'[]'::jsonb) into body
 from (select m.store_code, m.bkt, count(distinct m.id) so_n, sum(m.total) total, sum(m.tally) tally,
   sum(m.sys_qty) sys_qty, sum(m.abs_qty) abs_qty, sum(m.sys_value) sys_value, sum(m.abs_value) abs_value
   from m group by m.store_code, m.bkt) g;
 return body;
end;$$;

revoke all on function public.tsi_so_accuracy_trend(text,date,date,text) from public, anon;
grant execute on function public.tsi_so_accuracy_trend(text,date,date,text) to authenticated;
