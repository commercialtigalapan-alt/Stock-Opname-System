-- 202610280006: nama user (bukan email) di seluruh menu, dan Riwayat Upload semua toko untuk Admin.
-- Jalankan SETELAH 202610280005_sku_rounds_final_qty.sql. Aman dijalankan ulang.

-- 1) Nama lengkap user. Kosong = tampil email.
alter table public.tsi_so_users add column if not exists full_name text;

create or replace function public.tsi_so_set_user_name(p_user uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
declare who text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 if not exists(select 1 from public.tsi_so_users where user_id=p_user) then raise exception 'User belum aktif.'; end if;
 update public.tsi_so_users set full_name=nullif(btrim(left(coalesce(p_name,''),80)),'') where user_id=p_user;
end;$$;

revoke all on function public.tsi_so_set_user_name(uuid,text) from public, anon;
grant execute on function public.tsi_so_set_user_name(uuid,text) to authenticated;

-- 2) Profil login: kirim nama tampilan.
create or replace function public.tsi_so_me()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; allowed jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Akun belum diaktifkan oleh Admin SO.' using errcode='28000'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'area',s.area) order by s.name),'[]'::jsonb)
 into allowed from public.tsi_so_stores s where s.active and
 (u.role='admin' or (u.role='store' and s.code=u.store_code) or
 (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=s.code)));
 return jsonb_build_object('id',u.user_id,'email',u.email,'name',coalesce(nullif(btrim(u.full_name),''),u.email),
  'role',u.role,'store_code',u.store_code,'stores',allowed);
end;$$;

-- 3) Daftar user (Manajemen Akses): tampilkan nama, email tetap ada.
create or replace function public.tsi_so_users_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.user_id,'email',u.email,'full_name',coalesce(u.full_name,''),
  'name',coalesce(nullif(btrim(u.full_name),''),u.email),'role',u.role,'store_code',u.store_code,
  'spv_stores',(select coalesce(jsonb_agg(a.store_code),'[]'::jsonb) from public.tsi_so_spv_stores a where a.user_id=u.user_id))
  order by coalesce(nullif(btrim(u.full_name),''),u.email)),'[]'::jsonb)
 into body from public.tsi_so_users u;
 return body;
end;$$;

-- 4) SPV Mapping: nama SPV.
create or replace function public.tsi_so_spv_mapping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'area',s.area,'spv_user',a.user_id,
  'spv_email',u.email,'spv_name',coalesce(nullif(btrim(u.full_name),''),u.email)) order by s.name),'[]'::jsonb)
 into body from public.tsi_so_stores s
 left join public.tsi_so_spv_stores a on a.store_code=s.code
 left join public.tsi_so_users u on u.user_id=a.user_id
 where s.active;
 return body;
end;$$;

-- 5) Dashboard: kolom SPV per toko memakai nama.
create or replace function public.tsi_so_store_analytics(p_type text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; s record; k jsonb; out jsonb:='[]'::jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 for s in
  select st.code, st.name, st.area,
   (select coalesce(nullif(btrim(x.full_name),''),x.email) from public.tsi_so_spv_stores a join public.tsi_so_users x on x.user_id=a.user_id
     where a.store_code=st.code order by 1 limit 1) spv_name
  from public.tsi_so_stores st
  where st.active and (u.role='admin' or (u.role='store' and st.code=u.store_code)
    or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=st.code)))
  order by st.area, st.name
 loop
  k:=public.tsi_so_kpi(s.code,p_type,p_from,p_to);
  out:=out||jsonb_build_array(jsonb_build_object('code',s.code,'name',s.name,'area',s.area,'spv',coalesce(s.spv_name,''))||k);
 end loop;
 return out;
end;$$;

-- 6) Audit: nama pelaku.
create or replace function public.tsi_so_audit_list(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(t.j),'[]'::jsonb) into body from (
  select jsonb_build_object('at',a.occurred_at,
   'user',coalesce((select nullif(btrim(x.full_name),'') from public.tsi_so_users x where x.user_id=a.user_id),
                   (select u.email from auth.users u where u.id=a.user_id)),
   'store',a.store_code,'event',a.event,'meta',a.meta) j
  from public.tsi_so_audit a
  order by a.occurred_at desc
  limit least(greatest(p_limit,1),500)) t;
 return body;
end;$$;

-- 7) Riwayat Upload: Admin melihat semua toko (p_store kosong), Store/SPV hanya tokonya.
drop function if exists public.tsi_so_upload_history(text);
create or replace function public.tsi_so_upload_history(p_store text default null, p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is null then raise exception 'Akses ditolak.'; end if;
 if p_store is not null then
  if public.tsi_so_authorize(p_store,true) not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 elsif who<>'admin' then
  raise exception 'Riwayat semua toko hanya untuk Admin.';
 end if;
 select coalesce(jsonb_agg(t.j),'[]'::jsonb) into body from (
  select jsonb_build_object('id',u.id,'uploaded_at',u.uploaded_at,'sku_count',u.sku_count,
   'store_code',u.store_code,'store_name',coalesce(s.name,u.store_code),'area',coalesce(s.area,''),
   'uploaded_by',coalesce((select nullif(btrim(x.full_name),'') from public.tsi_so_users x where x.user_id=u.uploaded_by),
                          (select a.email from auth.users a where a.id=u.uploaded_by),'-')) j
  from public.tsi_so_uploads u left join public.tsi_so_stores s on s.code=u.store_code
  where p_store is null or u.store_code=p_store
  order by u.uploaded_at desc
  limit least(greatest(coalesce(p_limit,100),1),500)) t;
 return body;
end;$$;

revoke all on function public.tsi_so_upload_history(text,integer) from public, anon;
grant execute on function public.tsi_so_upload_history(text,integer) to authenticated;

-- 8) Jadwal: PIC memakai nama user (salinan definisi terbaru dari 202610280003, hanya ekspresi PIC yang diganti).

CREATE OR REPLACE FUNCTION public.tsi_so_schedule_list(p_store text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare u public.tsi_so_users%rowtype; body jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 if p_store is not null then perform public.tsi_so_authorize(p_store,true); end if;
 select coalesce(jsonb_agg(t.j order by t.pd desc nulls last, t.sa desc),'[]'::jsonb) into body from (
  select c.planned_date pd, c.started_at sa, jsonb_build_object(
   'id',c.id,'store_code',c.store_code,'store_name',s.name,'so_type',c.so_type,'status',c.status,
   'planned_date',c.planned_date,'start_time',c.start_time,'end_time',c.end_time,'notes',c.notes,
   'started_at',c.started_at,'archived',c.archived_at is not null,
   'scope_rule',c.scope_rule,'team_map',c.team_map,
   'pic',coalesce(nullif(btrim(pu.full_name),''),split_part(pu.email,'@',1),''),
   'scope_count',case
     when c.archived_at is not null then coalesce(c.total_skus,0)
     when c.status='SCHEDULED' then case when c.scope_skus is not null then jsonb_array_length(c.scope_skus)
        else (select count(*) from public.tsi_so_inventory i where i.store_code=c.store_code) end
     else coalesce(x.total,0) end,
   'tally',case when c.archived_at is not null then c.tally_count when c.status in ('SUBMITTED','APPROVED') then coalesce(x.tally,0) end,
   'variance',case when c.archived_at is not null then c.variance_count when c.status in ('SUBMITTED','APPROVED') then coalesce(x.variance,0) end
  ) j
  from public.tsi_so_cycles c
  join public.tsi_so_stores s on s.code=c.store_code
  left join public.tsi_so_users pu on pu.user_id=c.started_by
  left join lateral (
   select count(*) total,
    count(*) filter(where public.tsi_so_actual(l) is not null and coalesce(l.validated_qty,public.tsi_so_actual(l))=l.system_at_start) tally,
    count(*) filter(where public.tsi_so_actual(l) is not null and coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start) variance
   from public.tsi_so_lines l where l.cycle_id=c.id) x on true
  where (p_store is null or c.store_code=p_store)
   and (u.role='admin'
     or (u.role='store' and c.store_code=u.store_code)
     or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=c.store_code)))
  limit 1000
 ) t;
 return body;
end;$$;
