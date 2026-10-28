-- 202610280010: Sinkronisasi ulang rasio SKU dari SO yang masih ada (Admin).
-- Dipakai untuk membuka SKU yang terkunci karena rasio dari SO yang sudah dihapus.
-- Jalankan SETELAH 202610280009_cleanup_and_fixes.sql. Aman dijalankan ulang.

-- Pratinjau (tidak mengubah data) dan penerapan (p_apply = true).
create or replace function public.tsi_so_rounds_resync(p_store text, p_apply boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; cur jsonb; newc jsonb; arch int; changed int; sample jsonb; applied boolean:=false;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 if not exists(select 1 from public.tsi_so_stores where code=p_store) then raise exception 'Kode toko tidak ditemukan.'; end if;

 create temp table if not exists _rr_new(sku text primary key, n int) on commit drop;
 create temp table if not exists _rr_old(sku text primary key, n int) on commit drop;
 delete from _rr_new where true; delete from _rr_old where true;
 -- rasio yang benar: jumlah SO (submit) yang masih punya detail, per SKU
 insert into _rr_new select l.sku, count(distinct c.id)::int
  from public.tsi_so_cycles c join public.tsi_so_lines l on l.cycle_id=c.id
  where c.store_code=p_store and c.rounds_recorded and c.archived_at is null
  group by l.sku;
 insert into _rr_old select r.sku, r.so_count from public.tsi_so_sku_rounds r where r.store_code=p_store;

 select count(*) into arch from public.tsi_so_cycles where store_code=p_store and rounds_recorded and archived_at is not null;
 select count(*) into changed from (
  select coalesce(o.sku,nw.sku) sku, coalesce(o.n,0) old_n, coalesce(nw.n,0) new_n
  from _rr_old o full join _rr_new nw on nw.sku=o.sku) d where d.old_n<>d.new_n;
 select coalesce(jsonb_agg(x order by x->>'sku'),'[]'::jsonb) into sample from (
  select jsonb_build_object('sku',coalesce(o.sku,nw.sku),'dari',coalesce(o.n,0),'menjadi',coalesce(nw.n,0)) x
  from _rr_old o full join _rr_new nw on nw.sku=o.sku
  where coalesce(o.n,0)<>coalesce(nw.n,0) limit 50) t;

 if p_apply then
  delete from public.tsi_so_sku_rounds where store_code=p_store;
  insert into public.tsi_so_sku_rounds(store_code,sku,so_count,last_date)
   select p_store,n.sku,n.n,current_date from _rr_new n;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
   values(auth.uid(),p_store,'ROUNDS_RESYNC',jsonb_build_object('changed',changed,'archived_not_counted',arch));
  applied:=true;
 end if;

 return jsonb_build_object('applied',applied,'changed',changed,'archived_recorded',arch,'sample',sample);
end;$$;

revoke all on function public.tsi_so_rounds_resync(text,boolean) from public, anon;
grant execute on function public.tsi_so_rounds_resync(text,boolean) to authenticated;
