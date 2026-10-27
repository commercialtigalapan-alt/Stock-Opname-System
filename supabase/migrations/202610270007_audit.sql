-- Manajemen Akses: Audit Trail untuk Admin (100 aktivitas terakhir).
-- Jalankan SETELAH 202610270006_upload_retail.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_audit_list(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(t.j),'[]'::jsonb) into body from (
  select jsonb_build_object('at',a.occurred_at,
   'user',(select u.email from auth.users u where u.id=a.user_id),
   'store',a.store_code,'event',a.event,'meta',a.meta) j
  from public.tsi_so_audit a
  order by a.occurred_at desc
  limit least(greatest(p_limit,1),500)) t;
 return body;
end;$$;

revoke all on function public.tsi_so_audit_list(integer) from public, anon;
grant execute on function public.tsi_so_audit_list(integer) to authenticated;
