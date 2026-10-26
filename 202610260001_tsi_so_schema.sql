-- TIGALAPAN STOCK OPNAME - Isolated schema namespace within existing Supabase project.
-- Does NOT drop/alter unrelated Commercial application tables.
-- Deploy from Supabase SQL Editor as project owner. Requires auth.users and pgcrypto.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.tsi_so_stores (
 code text primary key, name text not null, area text not null default '', active boolean not null default true
);
create table if not exists public.tsi_so_users (
 user_id uuid primary key references auth.users(id) on delete cascade,
 email text not null, role text not null check (role in ('store','spv','admin')),
 store_code text references public.tsi_so_stores(code), active boolean not null default true,
 created_at timestamptz not null default now(),
 constraint tsi_so_user_store_check check ((role = 'store' and store_code is not null) or (role <> 'store' and store_code is null))
);
create table if not exists public.tsi_so_spv_stores (
 user_id uuid not null references public.tsi_so_users(user_id) on delete cascade,
 store_code text not null references public.tsi_so_stores(code),
 primary key (user_id,store_code)
);
create table if not exists public.tsi_so_uploads (
 id uuid primary key default gen_random_uuid(), store_code text not null references public.tsi_so_stores(code),
 uploaded_by uuid not null references auth.users(id), uploaded_at timestamptz not null default now(),
 sku_count integer not null check (sku_count between 1 and 5000)
);
create table if not exists public.tsi_so_inventory (
 store_code text not null references public.tsi_so_stores(code), sku text not null,
 item_name text not null, category text not null default '', ending bigint not null check (ending >= 0),
 cost numeric(16,2) not null default 0 check (cost >= 0),
 upload_id uuid not null references public.tsi_so_uploads(id), updated_at timestamptz not null default now(),
 primary key (store_code,sku)
);
create table if not exists public.tsi_so_cycles (
 id uuid primary key default gen_random_uuid(), store_code text not null references public.tsi_so_stores(code),
 status text not null default 'COUNTING' check (status in ('COUNTING','RECOUNT','SUBMITTED','APPROVED')),
 started_at timestamptz not null default now(), started_by uuid not null references auth.users(id),
 upload_id uuid references public.tsi_so_uploads(id),
 submitted_at timestamptz, approved_at timestamptz, approved_by uuid references auth.users(id),
 recount_reason text
);
create unique index if not exists tsi_so_only_one_open on public.tsi_so_cycles(store_code) where status <> 'APPROVED';
create index if not exists tsi_so_cycles_history on public.tsi_so_cycles(store_code,started_at desc);
create table if not exists public.tsi_so_lines (
 id uuid primary key default gen_random_uuid(), cycle_id uuid not null references public.tsi_so_cycles(id) on delete cascade,
 sku text not null, item_name text not null, category text not null default '',
 system_at_start bigint not null check (system_at_start >= 0),
 unit_cost numeric(16,2) not null default 0,
 warehouse_qty bigint check (warehouse_qty >= 0), display_qty bigint check (display_qty >= 0),
 store_note text not null default '', validated_qty bigint check (validated_qty >= 0),
 spv_note text not null default '', updated_by uuid references auth.users(id), updated_at timestamptz,
 unique(cycle_id,sku)
);
create index if not exists tsi_so_lines_by_cycle on public.tsi_so_lines(cycle_id,sku);
create table if not exists public.tsi_so_pins (
 user_id uuid primary key references public.tsi_so_users(user_id) on delete cascade,
 pin_hash text not null, updated_at timestamptz not null default now()
);
create table if not exists public.tsi_so_pin_state (
 user_id uuid primary key references public.tsi_so_users(user_id) on delete cascade,
 fail_count int not null default 0, locked_until timestamptz, unlocked_until timestamptz
);
create table if not exists public.tsi_so_audit (
 id bigint generated always as identity primary key,
 user_id uuid, store_code text, event text not null, meta jsonb not null default '{}'::jsonb,
 occurred_at timestamptz not null default now()
);
create index if not exists tsi_so_audit_time on public.tsi_so_audit(occurred_at desc);

-- Explicitly deny client direct table access. All business access goes through tightly-scoped RPC functions.
do $$ declare t text; begin
 foreach t in array array['tsi_so_stores','tsi_so_users','tsi_so_spv_stores','tsi_so_uploads','tsi_so_inventory','tsi_so_cycles','tsi_so_lines','tsi_so_pins','tsi_so_pin_state','tsi_so_audit'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on table public.%I from anon, authenticated', t);
 end loop;
end $$;

-- Seed only store metadata (NO inventory, no user credentials).
insert into public.tsi_so_stores(code,name,area) values
 ('TPK-MKS','Tigalapankaos Makassar','Makassar'),('MAMU-BTP','MAMU BTP','Makassar'),
 ('TPK-PLU','Tigalapankaos Palu','Palu'),('TPK-PLM','Tigalapankaos Palopo','Palopo'),
 ('TPK-SMD','Tigalapankaos Samarinda','Samarinda'),('TPK-TRJ','Tigalapankaos Toraja','Toraja'),
 ('TPK-MND','Tigalapankaos Manado','Manado'),('MAMU-GWA','MAMU Gowa','Gowa'),
 ('MAMU-PLP','MAMU Palopo','Palopo'),('MAMU-MKS','MAMU Makassar','Makassar'),
 ('MAMU-KDI','MAMU Kendari','Kendari'),('TPK-BNE','Tigalapankaos Bone','Bone')
on conflict(code) do nothing;

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
 return jsonb_build_object('id',u.user_id,'email',u.email,'role',u.role,'store_code',u.store_code,'stores',allowed);
end;$$;

create or replace function public.tsi_so_authorize(p_store text, p_allow_spv boolean default true)
returns text language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Sesi tidak mempunyai akses SO.' using errcode='42501'; end if;
 if p_store is not null and not exists(select 1 from public.tsi_so_stores where code=p_store and active) then
  raise exception 'Kode toko tidak ditemukan.' using errcode='22023'; end if;
 if p_store is not null and not (u.role='admin' or
 (u.role='store' and u.store_code=p_store) or
 (p_allow_spv and u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=p_store))) then
  raise exception 'Tidak memiliki akses ke toko ini.' using errcode='42501'; end if;
 return u.role;
end;$$;

create or replace function public.tsi_so_upload(p_store text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_count integer; v_bad integer; v_id uuid;
begin
 r:=public.tsi_so_authorize(p_store,false);
 if r not in ('store','admin') then raise exception 'Hanya toko / admin yang boleh upload.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Data inventory harus array.'; end if;
 v_count:=jsonb_array_length(p_rows);
 if v_count not between 1 and 5000 then raise exception 'Upload 1 sampai 5000 SKU per batch.'; end if;
 select count(*) into v_bad from jsonb_array_elements(p_rows) j
 where length(trim(coalesce(j->>'sku',''))) not between 1 and 80
    or length(trim(coalesce(j->>'name',''))) not between 1 and 250
    or coalesce(j->>'ending','') !~ '^[0-9]{1,12}$'
    or coalesce(nullif(j->>'cost',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
 if v_bad > 0 then raise exception 'Ada % baris tidak valid (SKU, nama, ending, cost).',v_bad; end if;
 select count(*) into v_bad from (select upper(trim(j->>'sku')) sku from jsonb_array_elements(p_rows) j group by 1 having count(*)>1) z;
 if v_bad>0 then raise exception 'Ada SKU duplikat: %.',v_bad; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 insert into public.tsi_so_uploads(store_code,uploaded_by,sku_count) values(p_store,auth.uid(),v_count) returning id into v_id;
 delete from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_inventory(store_code,sku,item_name,category,ending,cost,upload_id)
 select p_store,upper(trim(j->>'sku')),trim(j->>'name'),left(coalesce(j->>'category',''),120),
 (j->>'ending')::bigint,coalesce(nullif(j->>'cost',''),'0')::numeric,v_id
 from jsonb_array_elements(p_rows) j;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'UPLOAD',jsonb_build_object('upload_id',v_id,'skus',v_count));
 return jsonb_build_object('upload_id',v_id,'sku_count',v_count,'message','Inventory aktif diganti hanya untuk toko ini; stok awal SO berjalan tetap dikunci.');
end;$$;

create or replace function public.tsi_so_start(p_store text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int;
begin
 r:=public.tsi_so_authorize(p_store,false);
 if r not in ('store','admin') then raise exception 'Tidak dapat memulai SO.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 if exists(select 1 from public.tsi_so_cycles where store_code=p_store and status<>'APPROVED') then
  raise exception 'Masih ada SO aktif. Selesaikan terlebih dahulu.'; end if;
 select count(*),max(upload_id) into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 insert into public.tsi_so_cycles(store_code,started_by,upload_id) values(p_store,auth.uid(),v_upload) returning id into v_id;
 insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost)
 select v_id,sku,item_name,category,ending,cost from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_id,'skus',v_n));
 return v_id;
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
 'total',coalesce(st.total,0),'done',coalesce(st.done,0),
 'inventory_count',(select count(*) from public.tsi_so_inventory inv where inv.store_code=s.code),
 'tally',case when c.status in ('SUBMITTED','APPROVED') then st.tally else null end,
 'variance',case when c.status in ('SUBMITTED','APPROVED') then st.variance else null end,
 'accuracy',case when u.role in ('spv','admin') and c.status in ('SUBMITTED','APPROVED') and st.total>0 then round(st.tally::numeric/st.total,4) else null end,
 'qty_accuracy',case when u.role in ('spv','admin') and c.status in ('SUBMITTED','APPROVED') and st.total>0 then
   case when st.sys_qty=0 then case when st.abs_qty_diff=0 then 1 else 0 end
   else round(greatest(0,1-st.abs_qty_diff/st.sys_qty),4) end else null end,
 'value_accuracy',case when u.role in ('spv','admin') and c.status in ('SUBMITTED','APPROVED') and st.sys_value>0 then
 round(greatest(0,1-st.abs_value_diff/st.sys_value),4) else null end,
 'started_at',c.started_at) order by s.name),'[]'::jsonb) into arr
 from public.tsi_so_stores s
 left join lateral (select * from public.tsi_so_cycles x where x.store_code=s.code order by x.started_at desc,x.id desc limit 1) c on true
 left join lateral (select count(*) total,
 count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null) done,
 count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null and
      coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)=l.system_at_start) tally,
 count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null and
      coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start) variance,
 sum(l.system_at_start)::numeric sys_qty,
 sum(abs(coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start))::numeric abs_qty_diff,
 sum(l.system_at_start*l.unit_cost)::numeric sys_value,
 sum(abs(coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start)*l.unit_cost)::numeric abs_value_diff
 from public.tsi_so_lines l where l.cycle_id=c.id) st on true
 where s.active and (u.role='admin' or (u.role='store' and s.code=u.store_code) or
 (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=s.code)));
 return jsonb_build_object('role',u.role,'stores',arr);
end;$$;

create or replace function public.tsi_so_count_page(p_cycle uuid,p_offset integer default 0,p_limit integer default 50,p_search text default '',p_filter text default 'ALL')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; n integer; body jsonb; r text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if p_limit not between 1 and 100 or p_offset<0 then raise exception 'Pagination tidak valid.'; end if;
 if length(p_search)>120 then raise exception 'Pencarian terlalu panjang.'; end if;
 select count(*) into n from public.tsi_so_lines l where l.cycle_id=p_cycle and
 (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%') and
 (p_filter='ALL' or (p_filter='DONE' and l.warehouse_qty is not null and l.display_qty is not null) or
 (p_filter='PENDING' and (l.warehouse_qty is null or l.display_qty is null)));
 select coalesce(jsonb_agg(jsonb_build_object('sku',l.sku,'name',l.item_name,'category',l.category,
 'warehouse',l.warehouse_qty,'display',l.display_qty,'note',l.store_note,
 'status',case when l.warehouse_qty is null or l.display_qty is null then 'BELUM'
 when c.status in ('COUNTING','RECOUNT') then 'SELESAI'
 when coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)=l.system_at_start then 'TALLY' else 'SELISIH' end) order by l.sku),'[]'::jsonb) into body
 from (select * from public.tsi_so_lines l where l.cycle_id=p_cycle and
 (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%') and
 (p_filter='ALL' or (p_filter='DONE' and l.warehouse_qty is not null and l.display_qty is not null) or
 (p_filter='PENDING' and (l.warehouse_qty is null or l.display_qty is null)))
 order by l.sku limit p_limit offset p_offset) l;
 return jsonb_build_object('cycle_id',c.id,'store_code',c.store_code,'status',c.status,'total_filtered',n,'items',body);
end;$$;

create or replace function public.tsi_so_save_counts(p_cycle uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; r text; j jsonb; cnt int:=0; wh text; ds text; v_sku text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,false);
 if r not in ('store','admin') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO terkunci atau akses tidak diizinkan.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
 raise exception 'Simpan 1-100 SKU per batch.'; end if;
 for j in select value from jsonb_array_elements(p_rows) loop
  v_sku:=upper(trim(coalesce(j->>'sku','')));
  wh:=j->>'warehouse'; ds:=j->>'display';
  if (wh is not null and wh !~ '^[0-9]{1,12}$') or (ds is not null and ds !~ '^[0-9]{1,12}$') then
   raise exception 'Qty hanya bilangan bulat >= 0.'; end if;
  if length(coalesce(j->>'note',''))>500 then raise exception 'Catatan maksimal 500 karakter.'; end if;
  update public.tsi_so_lines set warehouse_qty=wh::bigint,display_qty=ds::bigint,
    store_note=coalesce(j->>'note',''),updated_at=now(),updated_by=auth.uid()
  where cycle_id=p_cycle and sku=v_sku;
  if not found then raise exception 'SKU % tidak terdaftar di SO.',v_sku; end if;
  cnt:=cnt+1;
 end loop;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'COUNT_SAVE',jsonb_build_object('cycle_id',p_cycle,'rows',cnt));
 return cnt;
end;$$;

create or replace function public.tsi_so_submit(p_cycle uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; r text; pending integer;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,false);
 if r not in ('store','admin') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO tidak dapat disubmit.'; end if;
 select count(*) into pending from public.tsi_so_lines where cycle_id=p_cycle and (warehouse_qty is null or display_qty is null);
 if pending>0 then raise exception 'Masih ada % SKU yang belum lengkap, termasuk Qty 0.',pending; end if;
 update public.tsi_so_cycles set status='SUBMITTED',submitted_at=now() where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SUBMIT',jsonb_build_object('cycle_id',p_cycle));
 return 'SUBMITTED';
end;$$;

create or replace function public.tsi_so_set_pin(p_user uuid,p_pin text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare role_current text;
begin
 select role into role_current from public.tsi_so_users where user_id=auth.uid() and active;
 if role_current is distinct from 'admin' then raise exception 'Hanya Admin yang boleh mengatur PIN.'; end if;
 if not exists(select 1 from public.tsi_so_users where user_id=p_user and role in ('spv','admin') and active) then
  raise exception 'User harus SPV/Admin aktif.'; end if;
 if p_pin !~ '^[0-9]{8,12}$' or p_pin in ('12345678','123456789','87654321','00000000') then
  raise exception 'PIN wajib 8-12 angka yang tidak mudah ditebak.'; end if;
 insert into public.tsi_so_pins(user_id,pin_hash) values(p_user,extensions.crypt(p_pin,extensions.gen_salt('bf',10)))
 on conflict(user_id) do update set pin_hash=excluded.pin_hash,updated_at=now();
 delete from public.tsi_so_pin_state where user_id=p_user;
 return true;
end;$$;

create or replace function public.tsi_so_unlock(p_pin text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare r text; st public.tsi_so_pin_state%rowtype; h text;
begin
 select role into r from public.tsi_so_users where user_id=auth.uid() and active;
 if r not in ('admin','spv') or r is null then raise exception 'Akun bukan SPV/Admin.'; end if;
 insert into public.tsi_so_pin_state(user_id) values(auth.uid()) on conflict(user_id) do nothing;
 select * into st from public.tsi_so_pin_state where user_id=auth.uid() for update;
 if st.locked_until is not null and st.locked_until>now() then return false; end if;
 select pin_hash into h from public.tsi_so_pins where user_id=auth.uid();
 if h is null then raise exception 'PIN belum diatur oleh Admin.'; end if;
 if extensions.crypt(coalesce(p_pin,''),h)<>h then
  update public.tsi_so_pin_state set
   fail_count=case when locked_until is not null and locked_until<=now() then 1 else fail_count+1 end,
   locked_until=case when (case when locked_until is not null and locked_until<=now() then 1 else fail_count+1 end)>=5 then now()+interval '15 minutes' else null end,
   unlocked_until=null where user_id=auth.uid();
  return false;
 end if;
 update public.tsi_so_pin_state set fail_count=0,locked_until=null,unlocked_until=now()+interval '15 minutes'
 where user_id=auth.uid();
 insert into public.tsi_so_audit(user_id,event,meta) values(auth.uid(),'SPV_PIN_UNLOCK','{}');
 return true;
end;$$;

create or replace function public.tsi_so_require_spv(p_store text)
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('spv','admin') then raise exception 'Hanya SPV/Admin.'; end if;
 if not exists(select 1 from public.tsi_so_pin_state where user_id=auth.uid() and unlocked_until>now()) then
 raise exception 'Buka menu Validasi dengan PIN terlebih dahulu.'; end if;
 return r;
end;$$;

create or replace function public.tsi_so_validation_page(p_cycle uuid,p_offset integer default 0,p_limit integer default 50,p_search text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; body jsonb; n integer;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'Pagination salah.'; end if;
 select count(*) into n from public.tsi_so_lines where cycle_id=p_cycle and (p_search='' or sku ilike '%'||p_search||'%' or item_name ilike '%'||p_search||'%');
 select coalesce(jsonb_agg(jsonb_build_object('sku',l.sku,'name',l.item_name,'category',l.category,
 'system_at_start',l.system_at_start,'latest_system',inv.ending,'warehouse',l.warehouse_qty,'display',l.display_qty,
 'actual',case when l.warehouse_qty is null or l.display_qty is null then null else l.warehouse_qty+l.display_qty end,
 'validated_qty',l.validated_qty,'store_note',l.store_note,'spv_note',l.spv_note,'cost',l.unit_cost,
 'delta',coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start) order by l.sku),'[]'::jsonb) into body
 from (select * from public.tsi_so_lines where cycle_id=p_cycle and
 (p_search='' or sku ilike '%'||p_search||'%' or item_name ilike '%'||p_search||'%') order by sku limit p_limit offset p_offset) l
 left join public.tsi_so_inventory inv on inv.store_code=c.store_code and inv.sku=l.sku;
 return jsonb_build_object('status',c.status,'store_code',c.store_code,'cycle_id',c.id,'total_filtered',n,'items',body);
end;$$;

create or replace function public.tsi_so_validate_line(p_cycle uuid,p_sku text,p_qty bigint,p_note text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'SUBMITTED' then raise exception 'Hanya SO SUBMITTED yang dapat divalidasi.'; end if;
 if p_qty<0 or length(coalesce(p_note,''))>500 then raise exception 'Qty/catatan validasi tidak sah.'; end if;
 update public.tsi_so_lines set validated_qty=p_qty,spv_note=coalesce(p_note,''),updated_at=now(),updated_by=auth.uid()
 where cycle_id=p_cycle and sku=upper(trim(p_sku));
 if not found then raise exception 'SKU tidak ditemukan.'; end if;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'VALIDATE_LINE',jsonb_build_object('cycle_id',p_cycle,'sku',p_sku));
 return true;
end;$$;

create or replace function public.tsi_so_approve(p_cycle uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; missing integer;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'SUBMITTED' then raise exception 'Hanya SO SUBMITTED yang dapat disetujui.'; end if;
 select count(*) into missing from public.tsi_so_lines l where l.cycle_id=p_cycle and
 (l.warehouse_qty is null or l.display_qty is null or
 (coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start and trim(l.spv_note)='' and trim(l.store_note)=''));
 if missing>0 then raise exception '% SKU belum lengkap atau selisih belum memiliki alasan.',missing; end if;
 update public.tsi_so_cycles set status='APPROVED',approved_at=now(),approved_by=auth.uid() where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'APPROVE',jsonb_build_object('cycle_id',p_cycle));
 return 'APPROVED';
end;$$;

create or replace function public.tsi_so_recount(p_cycle uuid,p_reason text)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'SUBMITTED' then raise exception 'SO tidak dalam status SUBMITTED.'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'Alasan recount wajib minimal 5 karakter.'; end if;
 update public.tsi_so_cycles set status='RECOUNT',recount_reason=left(p_reason,500),submitted_at=null where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'RECOUNT',jsonb_build_object('cycle_id',p_cycle,'reason',left(p_reason,500)));
 return 'RECOUNT';
end;$$;

create or replace function public.tsi_so_export(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; body jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'APPROVED' then raise exception 'Export hanya untuk SO APPROVED.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('SKU',l.sku,'NAME_VARIANT',l.item_name,
 'SYSTEM_AT_START',l.system_at_start,'ACTUAL',coalesce(l.validated_qty,l.warehouse_qty+l.display_qty),
 'ADJUSTMENT',coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)-l.system_at_start,'UNIT_COST',l.unit_cost,
 'REASON',coalesce(nullif(l.spv_note,''),l.store_note)) order by l.sku),'[]'::jsonb) into body
 from public.tsi_so_lines l where l.cycle_id=p_cycle;
 return body;
end;$$;

create or replace function public.tsi_so_assign_user(p_user uuid,p_role text,p_store text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare who text; em text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin dapat mengatur akun SO.'; end if;
 if p_role not in ('admin','spv','store') then raise exception 'Role tidak sah.'; end if;
 if (p_role='store') is distinct from (p_store is not null) then raise exception 'Store wajib memilih kode toko, Admin/SPV tidak.'; end if;
 if p_user=auth.uid() and p_role<>'admin' then raise exception 'Tidak boleh menurunkan role admin sendiri.'; end if;
 select email into em from auth.users where id=p_user;
 if em is null then raise exception 'User Auth belum terdaftar. Minta pengguna login/daftar dahulu.'; end if;
 if p_role='store' and not exists(select 1 from public.tsi_so_stores where code=p_store and active) then raise exception 'Toko tidak ditemukan.'; end if;
 insert into public.tsi_so_users(user_id,email,role,store_code) values(p_user,em,p_role,p_store)
 on conflict(user_id) do update set email=excluded.email,role=excluded.role,store_code=excluded.store_code,active=true;
 return true;
end;$$;

create or replace function public.tsi_so_assign_spv_store(p_user uuid,p_store text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare who text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 if not exists(select 1 from public.tsi_so_users where user_id=p_user and role='spv' and active) then raise exception 'User bukan SPV.'; end if;
 insert into public.tsi_so_spv_stores(user_id,store_code) values(p_user,p_store) on conflict do nothing;
 return true;
end;$$;

create or replace function public.tsi_so_users_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.user_id,'email',u.email,'role',u.role,'store_code',u.store_code,
 'spv_stores',(select coalesce(jsonb_agg(a.store_code),'[]'::jsonb) from public.tsi_so_spv_stores a where a.user_id=u.user_id)) order by u.email),'[]'::jsonb)
 into body from public.tsi_so_users u;
 return body;
end;$$;

create or replace function public.tsi_so_pending_users()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'email',q.email) order by q.email),'[]'::jsonb)
 into body from (select a.id,a.email from auth.users a
 where a.email is not null and not exists(select 1 from public.tsi_so_users u where u.user_id=a.id)
 order by a.created_at desc limit 100) q;
 return body;
end;$$;

-- By default PostgreSQL gives new functions EXECUTE privilege to PUBLIC.
-- Remove it for JUST the Tigalapan SO functions and grant to authenticated only.
do $$ declare rec record; begin
 for rec in select p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid) args
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname like 'tsi_so_%'
 loop
  execute format('revoke all on function public.%I(%s) from public, anon',rec.proname,rec.args);
  execute format('grant execute on function public.%I(%s) to authenticated',rec.proname,rec.args);
 end loop;
end $$;

-- IMPORTANT BOOTSTRAP (run separately AFTER creating first admin in Supabase Auth):
-- insert into public.tsi_so_users(user_id,email,role)
-- select id,email,'admin' from auth.users where lower(email)='operational@tigalapanindonesia.com'
-- on conflict(user_id) do update set role='admin',email=excluded.email,store_code=null,active=true;
