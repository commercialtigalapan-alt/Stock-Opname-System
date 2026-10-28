-- Beberapa SO per toko boleh dikerjakan bersamaan (COUNTING/RECOUNT/SUBMITTED).
-- 1) Hapus batas satu SO berjalan per toko.
-- 2) start_cycle: memulai SO terjadwal yang dipilih (bukan selalu yang paling awal).
-- 3) start(store) tetap ada: memulai jadwal paling awal, atau SO baru bila tidak ada jadwal.
-- Jalankan SETELAH 202610280020_schedule_while_counting.sql. Aman dijalankan ulang.

drop index if exists public.tsi_so_one_running;

create or replace function public.tsi_so_start_cycle(p_cycle uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; r text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('store','admin','spv') then raise exception 'Tidak dapat memulai SO.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||c.store_code));
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if c.status<>'SCHEDULED' then raise exception 'SO ini tidak dalam status terjadwal.'; end if;

 insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost,team)
 select c.id,i.sku,i.item_name,i.category,i.ending,i.cost,
  coalesce((select t->>'name' from jsonb_array_elements(coalesce(c.team_map,'[]'::jsonb)) t
    where public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name) limit 1),'')
 from public.tsi_so_inventory i
 where i.store_code=c.store_code and (c.scope_skus is null or i.sku in (select jsonb_array_elements_text(c.scope_skus)));
 if not found then raise exception 'Scope jadwal tidak menemukan SKU.'; end if;

 update public.tsi_so_cycles set status='COUNTING',started_at=now(),started_by=auth.uid() where id=c.id;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'START',jsonb_build_object('cycle_id',c.id,'scheduled',true));
 return c.id;
end;$$;

create or replace function public.tsi_so_start(p_store text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_next uuid;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('store','admin','spv') then raise exception 'Tidak dapat memulai SO.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));

 select id into v_next from public.tsi_so_cycles where store_code=p_store and status='SCHEDULED'
  order by planned_date nulls last, started_at limit 1;
 if found then return public.tsi_so_start_cycle(v_next); end if;

 select count(*),max(upload_id) into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 insert into public.tsi_so_cycles(store_code,started_by,upload_id) values(p_store,auth.uid(),v_upload) returning id into v_id;
 insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost)
 select v_id,sku,item_name,category,ending,cost from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_id,'skus',v_n));
 return v_id;
end;$$;

revoke all on function public.tsi_so_start_cycle(uuid) from public, anon;
grant execute on function public.tsi_so_start_cycle(uuid) to authenticated;
revoke all on function public.tsi_so_start(text) from public, anon;
grant execute on function public.tsi_so_start(text) to authenticated;
