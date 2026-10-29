-- store_analytics: tambah spv_list (semua SPV yang memegang toko) untuk filter SPV di Dashboard.
-- Field 'spv' (SPV pertama) tetap dipertahankan. Isi fungsi lain sama dengan 202610280006.
-- Jalankan SETELAH 202610280023_accuracy_trend.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_store_analytics(p_type text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; s record; k jsonb; out jsonb:='[]'::jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 for s in
  select st.code, st.name, st.area,
   (select coalesce(nullif(btrim(x.full_name),''),x.email) from public.tsi_so_spv_stores a join public.tsi_so_users x on x.user_id=a.user_id
     where a.store_code=st.code order by 1 limit 1) spv_name,
   (select coalesce(jsonb_agg(distinct coalesce(nullif(btrim(x.full_name),''),x.email)),'[]'::jsonb)
     from public.tsi_so_spv_stores a join public.tsi_so_users x on x.user_id=a.user_id
     where a.store_code=st.code) spv_list
  from public.tsi_so_stores st
  where st.active and (u.role='admin' or (u.role='store' and st.code=u.store_code)
    or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=st.code)))
  order by st.area, st.name
 loop
  k:=public.tsi_so_kpi(s.code,p_type,p_from,p_to);
  out:=out||jsonb_build_array(jsonb_build_object('code',s.code,'name',s.name,'area',s.area,
    'spv',coalesce(s.spv_name,''),'spv_list',s.spv_list)||k);
 end loop;
 return out;
end;$$;

revoke all on function public.tsi_so_store_analytics(text,date,date) from public, anon;
grant execute on function public.tsi_so_store_analytics(text,date,date) to authenticated;
