-- Perbaikan: tsi_so_start memakai max(uuid) yang tidak ada di PostgreSQL.
-- Jalankan SETELAH 202610270002_upload_limit.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_start(p_store text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int;
begin
 r:=public.tsi_so_authorize(p_store,false);
 if r not in ('store','admin') then raise exception 'Tidak dapat memulai SO.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 if exists(select 1 from public.tsi_so_cycles where store_code=p_store and status<>'APPROVED') then
  raise exception 'Masih ada SO aktif. Selesaikan terlebih dahulu.'; end if;
 select count(*),min(upload_id::text)::uuid into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 insert into public.tsi_so_cycles(store_code,started_by,upload_id) values(p_store,auth.uid(),v_upload) returning id into v_id;
 insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost)
 select v_id,sku,item_name,category,ending,cost from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_id,'skus',v_n));
 return v_id;
end;$$;

revoke all on function public.tsi_so_start(text) from public, anon;
grant execute on function public.tsi_so_start(text) to authenticated;
