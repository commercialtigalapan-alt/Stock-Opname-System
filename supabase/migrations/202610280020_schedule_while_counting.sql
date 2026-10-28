-- Jadwal SO boleh dibuat walau SO lain masih berjalan (COUNTING/RECOUNT/SUBMITTED).
-- Hanya satu SO yang sedang berjalan per toko; jadwal menunggu dan dimulai setelah SO sebelumnya APPROVED.
-- Dashboard menampilkan SO yang sedang berjalan lebih dulu. Jalankan SETELAH 202610280019. Aman dijalankan ulang.

drop index if exists public.tsi_so_only_one_open;
create unique index if not exists tsi_so_one_running on public.tsi_so_cycles(store_code)
 where status in ('COUNTING','RECOUNT','SUBMITTED');

create or replace function public.tsi_so_schedule_create(p_store text, p_type text, p_date date, p_start time, p_end time, p_notes text, p_rule jsonb default null, p_teams jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_rule jsonb; v_scope jsonb; v_teams jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 if p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 if p_date is null then raise exception 'Tanggal jadwal wajib diisi.'; end if;
 if p_start is not null and p_end is not null and p_end<=p_start then raise exception 'Jam selesai harus setelah jam mulai.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
  select count(*),min(upload_id::text)::uuid into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 v_teams:=public.tsi_so_teams_clean(p_teams);
 if v_teams is not null and jsonb_array_length(v_teams)=0 then v_teams:=null; end if;
 v_rule:=public.tsi_so_clean_rule(p_rule);
 if public.tsi_so_rule_empty(v_rule) then v_rule:=null; end if;
 if v_teams is not null then
  v_rule:=null;
  v_scope:=public.tsi_so_teams_scope(p_store,v_teams);
  if jsonb_array_length(v_scope)=0 then raise exception 'Pembagian tim tidak menemukan SKU di inventory toko.'; end if;
 elsif v_rule is not null then
  v_scope:=public.tsi_so_scope_skus(p_store,v_rule);
  if jsonb_array_length(v_scope)=0 then raise exception 'Scope tidak menemukan SKU di inventory toko.'; end if;
 end if;
 if p_type='PARTIAL' and v_teams is null and v_rule is null then raise exception 'Pilih minimal satu category atau SKU untuk Partial SO.'; end if;
 insert into public.tsi_so_cycles(store_code,status,started_by,upload_id,so_type,planned_date,start_time,end_time,notes,scope_rule,scope_skus,team_map,scheduled_by,scheduled_at)
 values(p_store,'SCHEDULED',auth.uid(),v_upload,p_type,p_date,p_start,p_end,left(coalesce(p_notes,''),500),v_rule,v_scope,v_teams,auth.uid(),now())
 returning id into v_id;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'SCHEDULE',jsonb_build_object('cycle_id',v_id,'type',p_type,'date',p_date,'teams',coalesce(jsonb_array_length(v_teams),0)));
 return jsonb_build_object('cycle_id',v_id,'scope_count',case when v_scope is not null then jsonb_array_length(v_scope) else v_n end);
end;$$;

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
 left join lateral (select * from public.tsi_so_cycles x where x.store_code=s.code order by case when x.status in ('COUNTING','RECOUNT','SUBMITTED') then 0 when x.status='SCHEDULED' then 1 else 2 end, case when x.status='SCHEDULED' then x.planned_date end asc nulls last, x.started_at desc, x.id desc limit 1) c on true
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
   count(*) filter(where public.tsi_so_actual(l) is not null) done,
   count(*) filter(where public.tsi_so_actual(l) is not null and
        coalesce(l.validated_qty,public.tsi_so_actual(l))=l.system_at_start) tally,
   count(*) filter(where public.tsi_so_actual(l) is not null and
        coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start) variance,
   sum(l.system_at_start)::numeric sys_qty,
   sum(abs(coalesce(l.validated_qty,public.tsi_so_actual(l))-l.system_at_start))::numeric abs_qty_diff,
   sum(l.system_at_start*l.unit_cost)::numeric sys_value,
   sum(abs(coalesce(l.validated_qty,public.tsi_so_actual(l))-l.system_at_start)*l.unit_cost)::numeric abs_value_diff
  from public.tsi_so_lines l where l.cycle_id=c.id) x
 ) st on true
 where s.active and (u.role='admin' or (u.role='store' and s.code=u.store_code) or
 (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=s.code)));
 return jsonb_build_object('role',u.role,'stores',arr);
end;$$;

revoke all on function public.tsi_so_dashboard() from public, anon;
grant execute on function public.tsi_so_dashboard() to authenticated;
