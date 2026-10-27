-- Menu SO Schedule: jadwal Grand/Partial SO per toko.
-- Jalankan SETELAH 202610270003_fix_start.sql. Aman dijalankan ulang.

-- 1) Status SCHEDULED + kolom jadwal pada siklus SO
alter table public.tsi_so_cycles drop constraint if exists tsi_so_cycles_status_check;
alter table public.tsi_so_cycles add constraint tsi_so_cycles_status_check
 check (status in ('SCHEDULED','COUNTING','RECOUNT','SUBMITTED','APPROVED'));

alter table public.tsi_so_cycles
 add column if not exists so_type text not null default 'GRAND' check (so_type in ('GRAND','PARTIAL')),
 add column if not exists planned_date date,
 add column if not exists start_time time,
 add column if not exists end_time time,
 add column if not exists notes text not null default '',
 add column if not exists scope_skus jsonb,
 add column if not exists scheduled_by uuid references auth.users(id),
 add column if not exists scheduled_at timestamptz;

-- 2) Daftar SKU toko untuk pemilihan Partial SO (Admin/SPV saja, stok sistem ditampilkan)
create or replace function public.tsi_so_inventory_list(p_store text, p_offset integer default 0, p_limit integer default 100, p_search text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb; q text;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 q:=coalesce(trim(p_search),'');
 select jsonb_build_object(
  'total',(select count(*) from public.tsi_so_inventory i where i.store_code=p_store
     and (q='' or i.sku ilike '%'||upper(q)||'%' or i.item_name ilike '%'||q||'%')),
  'items',(select coalesce(jsonb_agg(t.j),'[]'::jsonb) from (
     select jsonb_build_object('sku',i.sku,'name',i.item_name,'category',i.category,'ending',i.ending) j
     from public.tsi_so_inventory i where i.store_code=p_store
       and (q='' or i.sku ilike '%'||upper(q)||'%' or i.item_name ilike '%'||q||'%')
     order by i.ending desc, i.sku
     limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)) t))
 into body;
 return body;
end;$$;

-- 3) Buat jadwal SO (lingkup disimpan; stok awal dikunci saat SO benar-benar dimulai)
create or replace function public.tsi_so_schedule_create(p_store text, p_type text, p_date date, p_start time, p_end time, p_notes text, p_skus jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_scope jsonb; v_pick int;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin atau SPV yang membuat jadwal SO.'; end if;
 if p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 if p_date is null then raise exception 'Tanggal jadwal wajib diisi.'; end if;
 if p_start is not null and p_end is not null and p_end<=p_start then raise exception 'Jam selesai harus setelah jam mulai.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 if exists(select 1 from public.tsi_so_cycles where store_code=p_store and status<>'APPROVED') then
  raise exception 'Masih ada SO aktif atau terjadwal untuk toko ini.'; end if;
 select count(*),min(upload_id::text)::uuid into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 if p_type='PARTIAL' then
  if jsonb_typeof(p_skus) is distinct from 'array' or jsonb_array_length(p_skus)=0 then
   raise exception 'Pilih minimal satu SKU untuk Partial SO.'; end if;
  select coalesce(jsonb_agg(distinct upper(trim(x))),'[]'::jsonb) into v_scope from jsonb_array_elements_text(p_skus) x;
  select count(*) into v_pick from public.tsi_so_inventory where store_code=p_store and sku in (select jsonb_array_elements_text(v_scope));
  if v_pick=0 then raise exception 'SKU yang dipilih tidak ditemukan di inventory toko.'; end if;
 else
  v_scope:=null;
  v_pick:=v_n;
 end if;
 insert into public.tsi_so_cycles(store_code,status,started_by,upload_id,so_type,planned_date,start_time,end_time,notes,scope_skus,scheduled_by,scheduled_at)
 values(p_store,'SCHEDULED',auth.uid(),v_upload,p_type,p_date,p_start,p_end,left(coalesce(p_notes,''),500),v_scope,auth.uid(),now())
 returning id into v_id;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'SCHEDULE',jsonb_build_object('cycle_id',v_id,'type',p_type,'date',p_date,'skus',v_pick));
 return jsonb_build_object('cycle_id',v_id,'scope_count',v_pick);
end;$$;

-- 4) Daftar jadwal SO (Admin semua toko; SPV sesuai area)
create or replace function public.tsi_so_schedule_list(p_store text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; body jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 if u.role='store' then raise exception 'Menu jadwal hanya untuk Admin dan SPV.'; end if;
 if p_store is not null then perform public.tsi_so_authorize(p_store,true); end if;
 select coalesce(jsonb_agg(t.j),'[]'::jsonb) into body from (
  select jsonb_build_object('id',c.id,'store_code',c.store_code,'store_name',s.name,'so_type',c.so_type,
   'status',c.status,'planned_date',c.planned_date,'start_time',c.start_time,'end_time',c.end_time,
   'notes',c.notes,'started_at',c.started_at,
   'scope_count',case when c.so_type='GRAND' then (select count(*) from public.tsi_so_inventory i where i.store_code=c.store_code)
     else jsonb_array_length(coalesce(c.scope_skus,'[]'::jsonb)) end) j
  from public.tsi_so_cycles c join public.tsi_so_stores s on s.code=c.store_code
  where (p_store is null or c.store_code=p_store)
    and (u.role='admin' or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=c.store_code)))
  order by c.planned_date desc nulls last, c.started_at desc
  limit 300) t;
 return body;
end;$$;

-- 5) Mulai SO: jika ada jadwal, jadwal diaktifkan dan stok awal dikunci dari lingkup jadwal
create or replace function public.tsi_so_start(p_store text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_sched record;
begin
 r:=public.tsi_so_authorize(p_store,false);
 if r not in ('store','admin') then raise exception 'Tidak dapat memulai SO.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 if exists(select 1 from public.tsi_so_cycles where store_code=p_store and status in ('COUNTING','RECOUNT','SUBMITTED')) then
  raise exception 'Masih ada SO aktif. Selesaikan terlebih dahulu.'; end if;
 select * into v_sched from public.tsi_so_cycles where store_code=p_store and status='SCHEDULED'
  order by planned_date nulls last, started_at limit 1;
 if found then
  insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost)
  select v_sched.id,i.sku,i.item_name,i.category,i.ending,i.cost from public.tsi_so_inventory i
  where i.store_code=p_store and (v_sched.so_type='GRAND' or i.sku in (select jsonb_array_elements_text(v_sched.scope_skus)));
  update public.tsi_so_cycles set status='COUNTING',started_at=now(),started_by=auth.uid() where id=v_sched.id;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
  values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_sched.id,'scheduled',true));
  return v_sched.id;
 end if;
 select count(*),min(upload_id::text)::uuid into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 insert into public.tsi_so_cycles(store_code,started_by,upload_id) values(p_store,auth.uid(),v_upload) returning id into v_id;
 insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost)
 select v_id,sku,item_name,category,ending,cost from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_id,'skus',v_n));
 return v_id;
end;$$;

-- Hak akses: hanya user login yang boleh memanggil fungsi SO
revoke all on function public.tsi_so_inventory_list(text,integer,integer,text) from public, anon;
grant execute on function public.tsi_so_inventory_list(text,integer,integer,text) to authenticated;
revoke all on function public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb) from public, anon;
grant execute on function public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb) to authenticated;
revoke all on function public.tsi_so_schedule_list(text) from public, anon;
grant execute on function public.tsi_so_schedule_list(text) to authenticated;
revoke all on function public.tsi_so_start(text) from public, anon;
grant execute on function public.tsi_so_start(text) to authenticated;
