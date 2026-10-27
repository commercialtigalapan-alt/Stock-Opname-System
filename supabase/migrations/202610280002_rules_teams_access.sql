-- Scope per Category + Warna, pembagian Grand SO per tim/POS, akses Store/SPV, validasi tanpa PIN,
-- SPV mapping, dan sumber warna konsisten. Jalankan SETELAH 202610280001_app_parity.sql. Aman dijalankan ulang.

-- 1) Kolom baru
alter table public.tsi_so_cycles
 add column if not exists scope_rule jsonb,
 add column if not exists team_map jsonb;
alter table public.tsi_so_lines
 add column if not exists team text not null default '';

-- 2) Warna dari nama produk: teks sebelum ukuran/bahan (mis. "ABU MUDA 24S PDK 2XL" -> ABU MUDA)
create or replace function public.tsi_so_color_of(p_name text)
returns text language sql immutable as $$
 select coalesce(nullif(trim(substring(upper(coalesce(p_name,'')) from '^(.*?)\s+\d+S(\s|$)')),''),'TANPA WARNA')
$$;

-- 3) Aturan scope: {"skus":[...],"categories":[...],"colors":{"KATEGORI":["WARNA",...]}}
--    Kategori tanpa daftar warna berarti seluruh warna pada kategori tersebut.
create or replace function public.tsi_so_rule_match(p_rule jsonb, p_sku text, p_category text, p_name text)
returns boolean language sql immutable as $$
 select coalesce(
   (p_rule->'skus') ? p_sku
   or ((p_rule->'categories') ? p_category
       and (not ((p_rule->'colors') ? p_category)
            or ((p_rule->'colors')->p_category) ? public.tsi_so_color_of(p_name))),
   false)
$$;

create or replace function public.tsi_so_clean_rule(p_rule jsonb)
returns jsonb language plpgsql as $$
declare cats jsonb; cols jsonb; skus jsonb;
begin
 if p_rule is null or jsonb_typeof(p_rule)<>'object' then return null; end if;
 select coalesce(jsonb_agg(distinct e.v),'[]'::jsonb) into cats
 from jsonb_array_elements_text(coalesce(p_rule->'categories','[]'::jsonb)) as e(v) where trim(e.v)<>'';
 select coalesce(jsonb_agg(distinct upper(trim(e.v))),'[]'::jsonb) into skus
 from jsonb_array_elements_text(coalesce(p_rule->'skus','[]'::jsonb)) as e(v) where trim(e.v)<>'';
 select coalesce(jsonb_object_agg(z.k,z.v),'{}'::jsonb) into cols from (
  select kv.key k, kv.value v from jsonb_each(coalesce(p_rule->'colors','{}'::jsonb)) kv
  where jsonb_typeof(kv.value)='array' and jsonb_array_length(kv.value)>0
    and kv.key in (select c.v from jsonb_array_elements_text(cats) as c(v))) z;
 return jsonb_build_object('categories',cats,'colors',cols,'skus',skus);
end;$$;

create or replace function public.tsi_so_rule_empty(p_rule jsonb)
returns boolean language sql immutable as $$
 select p_rule is null or (jsonb_array_length(coalesce(p_rule->'categories','[]'::jsonb))=0
        and jsonb_array_length(coalesce(p_rule->'skus','[]'::jsonb))=0)
$$;

create or replace function public.tsi_so_teams_clean(p_teams jsonb)
returns jsonb language plpgsql as $$
declare out jsonb:='[]'::jsonb; t jsonb; rule jsonb;
begin
 if p_teams is null then return null; end if;
 if jsonb_typeof(p_teams)<>'array' then raise exception 'Format pembagian tim tidak sah.'; end if;
 for t in select value from jsonb_array_elements(p_teams) loop
  if length(trim(coalesce(t->>'name','')))=0 then raise exception 'Nama tim/POS wajib diisi.'; end if;
  rule:=public.tsi_so_clean_rule(t->'rule');
  if public.tsi_so_rule_empty(rule) then raise exception 'Tim % belum memiliki category atau SKU.',trim(t->>'name'); end if;
  out:=out||jsonb_build_array(jsonb_build_object('name',left(trim(t->>'name'),60),'rule',rule));
 end loop;
 return out;
end;$$;

-- 4) Hapus fungsi versi sebelumnya (signature berubah)
drop function if exists public.tsi_so_scope_skus(text,jsonb,text[]);
drop function if exists public.tsi_so_scope_preview(text,text,jsonb,text[]);
drop function if exists public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb,text[]);
drop function if exists public.tsi_so_schedule_update(uuid,text,date,time,time,text,jsonb,text[]);
drop function if exists public.tsi_so_count_page(uuid,integer,integer,text,text);

create or replace function public.tsi_so_scope_skus(p_store text, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
 select coalesce(jsonb_agg(t.sku order by t.sku),'[]'::jsonb) into r from (
  select i.sku from public.tsi_so_inventory i
  where i.store_code=p_store and public.tsi_so_rule_match(p_rule,i.sku,i.category,i.item_name)) t;
 return r;
end;$$;

-- 5) Preview scope (SKU dan contoh) untuk Partial / Grand
create or replace function public.tsi_so_scope_preview(p_store text, p_type text, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; rule jsonb:=public.tsi_so_clean_rule(p_rule); v jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 if p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 if public.tsi_so_rule_empty(rule) then
  if p_type='PARTIAL' then return jsonb_build_object('count',0,'sample','[]'::jsonb); end if;
  return jsonb_build_object('count',(select count(*) from public.tsi_so_inventory i where i.store_code=p_store),
   'sample',(select coalesce(jsonb_agg(t.sku),'[]'::jsonb) from (select i.sku from public.tsi_so_inventory i where i.store_code=p_store order by i.sku limit 30) t));
 end if;
 v:=public.tsi_so_scope_skus(p_store,rule);
 return jsonb_build_object('count',jsonb_array_length(v),
  'sample',(select coalesce(jsonb_agg(t.sku),'[]'::jsonb) from (select e.v sku from jsonb_array_elements_text(v) as e(v) limit 30) t));
end;$$;

-- 6) Statistik warna per kategori: jumlah SKU dan riwayat SO (x SO, terakhir kapan)
create or replace function public.tsi_so_color_stats(p_store text, p_category text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 with inv as (
   select public.tsi_so_color_of(i.item_name) color, i.sku from public.tsi_so_inventory i
   where i.store_code=p_store and i.category=p_category),
 cnt as (select color, count(*) sku_count from inv group by color),
 cy as (select c.id, c.planned_date, c.scope_skus from public.tsi_so_cycles c
   where c.store_code=p_store and c.status<>'SCHEDULED'),
 hit as (select cy.id, cy.planned_date, inv.color from cy join inv
   on (cy.scope_skus is null or inv.sku in (select jsonb_array_elements_text(cy.scope_skus)))),
 st as (select color, count(distinct id) so_count, max(planned_date) last_date from hit group by color)
 select coalesce(jsonb_agg(jsonb_build_object('color',cnt.color,'sku_count',cnt.sku_count,
   'so_count',coalesce(st.so_count,0),'last_date',st.last_date) order by cnt.color),'[]'::jsonb) into body
 from cnt left join st on st.color=cnt.color;
 return body;
end;$$;

-- 7) Buat jadwal: scope (rule) + pembagian tim/POS (opsional)
create or replace function public.tsi_so_schedule_create(p_store text, p_type text, p_date date, p_start time, p_end time, p_notes text, p_rule jsonb default null, p_teams jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_rule jsonb; v_scope jsonb; v_teams jsonb;
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

-- 8) Ubah jadwal (hanya SCHEDULED). p_rule/p_teams null = pertahankan yang lama.
create or replace function public.tsi_so_schedule_update(p_cycle uuid, p_type text, p_date date, p_start time, p_end time, p_notes text, p_rule jsonb default null, p_teams jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; c public.tsi_so_cycles%rowtype; v_rule jsonb; v_scope jsonb; v_teams jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'Jadwal tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin atau SPV yang mengubah jadwal.'; end if;
 if c.status<>'SCHEDULED' then raise exception 'Hanya jadwal berstatus SCHEDULED yang bisa diubah.'; end if;
 if p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 if p_date is null then raise exception 'Tanggal jadwal wajib diisi.'; end if;
 if p_start is not null and p_end is not null and p_end<=p_start then raise exception 'Jam selesai harus setelah jam mulai.'; end if;
 if p_teams is not null then
  v_teams:=public.tsi_so_teams_clean(p_teams);
  if v_teams is not null and jsonb_array_length(v_teams)=0 then v_teams:=null; end if;
 else
  v_teams:=c.team_map;
 end if;
 if v_teams is not null then
  v_rule:=null;
  v_scope:=public.tsi_so_teams_scope(c.store_code,v_teams);
  if jsonb_array_length(v_scope)=0 then raise exception 'Pembagian tim tidak menemukan SKU di inventory toko.'; end if;
 else
  if p_rule is not null then
   v_rule:=public.tsi_so_clean_rule(p_rule);
   if public.tsi_so_rule_empty(v_rule) then v_rule:=null; end if;
  else
   v_rule:=c.scope_rule;
  end if;
  if v_rule is not null then
   v_scope:=public.tsi_so_scope_skus(c.store_code,v_rule);
   if jsonb_array_length(v_scope)=0 then raise exception 'Scope tidak menemukan SKU di inventory toko.'; end if;
  end if;
 end if;
 if p_type='PARTIAL' and v_teams is null and v_rule is null then raise exception 'Partial SO memerlukan scope category atau SKU.'; end if;
 update public.tsi_so_cycles set so_type=p_type, planned_date=p_date, start_time=p_start, end_time=p_end,
  notes=left(coalesce(p_notes,''),500), scope_rule=v_rule, scope_skus=v_scope, team_map=v_teams
 where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SCHEDULE_EDIT',jsonb_build_object('cycle_id',p_cycle,'type',p_type,'date',p_date));
 return jsonb_build_object('cycle_id',p_cycle);
end;$$;

-- 9) Daftar jadwal: Admin semua, SPV area, Store hanya tokonya (read-only di aplikasi)
create or replace function public.tsi_so_schedule_list(p_store text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
   'pic',coalesce(split_part(pu.email,'@',1),''),
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
    count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null and coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)=l.system_at_start) tally,
    count(*) filter(where l.warehouse_qty is not null and l.display_qty is not null and coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)<>l.system_at_start) variance
   from public.tsi_so_lines l where l.cycle_id=c.id) x on true
  where (p_store is null or c.store_code=p_store)
   and (u.role='admin'
     or (u.role='store' and c.store_code=u.store_code)
     or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=c.store_code)))
  limit 1000
 ) t;
 return body;
end;$$;

-- 10) Mulai SO: label tim/POS dipasang ke setiap SKU sesuai pembagian jadwal
create or replace function public.tsi_so_start(p_store text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_sched record;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('store','admin','spv') then raise exception 'Tidak dapat memulai SO.'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 if exists(select 1 from public.tsi_so_cycles where store_code=p_store and status in ('COUNTING','RECOUNT','SUBMITTED')) then
  raise exception 'Masih ada SO aktif. Selesaikan terlebih dahulu.'; end if;
 select * into v_sched from public.tsi_so_cycles where store_code=p_store and status='SCHEDULED'
  order by planned_date nulls last, started_at limit 1;
 if found then
  insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost,team)
  select v_sched.id,i.sku,i.item_name,i.category,i.ending,i.cost,
   coalesce((select t->>'name' from jsonb_array_elements(coalesce(v_sched.team_map,'[]'::jsonb)) t
     where public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name) limit 1),'')
  from public.tsi_so_inventory i
  where i.store_code=p_store and (v_sched.scope_skus is null or i.sku in (select jsonb_array_elements_text(v_sched.scope_skus)));
  if not found then raise exception 'Scope jadwal tidak menemukan SKU.'; end if;
  update public.tsi_so_cycles set status='COUNTING',started_at=now(),started_by=auth.uid() where id=v_sched.id;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
  values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_sched.id,'scheduled',true));
  return v_sched.id;
 end if;
 select count(*),max(upload_id) into v_n,v_upload from public.tsi_so_inventory where store_code=p_store;
 if v_n=0 then raise exception 'Upload inventory terlebih dahulu.'; end if;
 insert into public.tsi_so_cycles(store_code,started_by,upload_id) values(p_store,auth.uid(),v_upload) returning id into v_id;
 insert into public.tsi_so_lines(cycle_id,sku,item_name,category,system_at_start,unit_cost)
 select v_id,sku,item_name,category,ending,cost from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'START',jsonb_build_object('cycle_id',v_id,'skus',v_n));
 return v_id;
end;$$;

-- 11) Counting: SPV dan Store boleh; filter per tim/POS
create or replace function public.tsi_so_count_page(p_cycle uuid,p_offset integer default 0,p_limit integer default 50,p_search text default '',p_filter text default 'ALL',p_team text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; n integer; body jsonb; teams jsonb; r text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if p_limit not between 1 and 100 or p_offset<0 then raise exception 'Pagination tidak valid.'; end if;
 if length(p_search)>120 then raise exception 'Pencarian terlalu panjang.'; end if;
 select count(*) into n from public.tsi_so_lines l where l.cycle_id=p_cycle and
 (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%') and
 (p_team is null or l.team=p_team) and
 (p_filter='ALL' or (p_filter='DONE' and l.warehouse_qty is not null and l.display_qty is not null) or
 (p_filter='PENDING' and (l.warehouse_qty is null or l.display_qty is null)));
 select coalesce(jsonb_agg(jsonb_build_object('sku',l.sku,'name',l.item_name,'category',l.category,'team',l.team,
 'warehouse',l.warehouse_qty,'display',l.display_qty,'note',l.store_note,
 'status',case when l.warehouse_qty is null or l.display_qty is null then 'BELUM'
 when c.status in ('COUNTING','RECOUNT') then 'SELESAI'
 when coalesce(l.validated_qty,l.warehouse_qty+l.display_qty)=l.system_at_start then 'TALLY' else 'SELISIH' end) order by l.sku),'[]'::jsonb) into body
 from (select * from public.tsi_so_lines l where l.cycle_id=p_cycle and
 (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%') and
 (p_team is null or l.team=p_team) and
 (p_filter='ALL' or (p_filter='DONE' and l.warehouse_qty is not null and l.display_qty is not null) or
 (p_filter='PENDING' and (l.warehouse_qty is null or l.display_qty is null)))
 order by l.sku limit p_limit offset p_offset) l;
 select coalesce(jsonb_agg(z.t order by z.t),'[]'::jsonb) into teams
 from (select distinct l.team t from public.tsi_so_lines l where l.cycle_id=p_cycle and l.team<>'') z;
 return jsonb_build_object('cycle_id',c.id,'store_code',c.store_code,'status',c.status,'total_filtered',n,'items',body,'teams',teams);
end;$$;

-- 12) Store & SPV boleh menghitung, upload, memulai, dan submit (Store hanya tokonya)
create or replace function public.tsi_so_upload(p_store text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_count integer; v_bad integer; v_id uuid;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('store','admin','spv') then raise exception 'Tidak memiliki akses upload.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Data inventory harus array.'; end if;
 v_count:=jsonb_array_length(p_rows);
 if v_count not between 1 and 10000 then raise exception 'Upload 1 sampai 10000 SKU per batch.'; end if;
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

create or replace function public.tsi_so_save_counts(p_cycle uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; r text; j jsonb; cnt int:=0; wh text; ds text; v_sku text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('store','admin','spv') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO terkunci atau akses tidak diizinkan.'; end if;
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
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('store','admin','spv') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO tidak dapat disubmit.'; end if;
 select count(*) into pending from public.tsi_so_lines where cycle_id=p_cycle and (warehouse_qty is null or display_qty is null);
 if pending>0 then raise exception 'Masih ada % SKU yang belum lengkap. Isi 0 jika kosong.',pending; end if;
 update public.tsi_so_cycles set status='SUBMITTED',submitted_at=now() where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SUBMIT',jsonb_build_object('cycle_id',p_cycle));
 return 'SUBMITTED';
end;$$;

-- 13) Validasi SPV tanpa PIN (akses dibatasi oleh peran dan area SPV)
create or replace function public.tsi_so_require_spv(p_store text)
returns text language plpgsql security definer set search_path = '' as $$
declare r text;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('spv','admin') then raise exception 'Hanya SPV/Admin.'; end if;
 return r;
end;$$;

-- 14) SPV mapping: satu SPV per toko (Admin)
create or replace function public.tsi_so_set_store_spv(p_store text, p_user uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin yang mengatur mapping SPV.'; end if;
 if not exists(select 1 from public.tsi_so_stores where code=p_store) then raise exception 'Toko tidak ditemukan.'; end if;
 if p_user is not null and not exists(select 1 from public.tsi_so_users where user_id=p_user and role='spv' and active) then
  raise exception 'Pengguna harus berperan SPV dan aktif.'; end if;
 delete from public.tsi_so_spv_stores where store_code=p_store;
 if p_user is not null then insert into public.tsi_so_spv_stores(user_id,store_code) values(p_user,p_store); end if;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'SPV_MAP',jsonb_build_object('spv',p_user));
 return jsonb_build_object('store',p_store,'spv',p_user);
end;$$;

create or replace function public.tsi_so_spv_mapping()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('code',s.code,'name',s.name,'area',s.area,'spv_user',a.user_id,'spv_email',u.email) order by s.name),'[]'::jsonb)
 into body from public.tsi_so_stores s
 left join public.tsi_so_spv_stores a on a.store_code=s.code
 left join public.tsi_so_users u on u.user_id=a.user_id
 where s.active;
 return body;
end;$$;

-- 15) Hasil SKU untuk pembagian tim: gabungan SKU dari semua tim (tanpa duplikat)
create or replace function public.tsi_so_teams_scope(p_store text, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
 select coalesce(jsonb_agg(t.sku order by t.sku),'[]'::jsonb) into r from (
  select i.sku from public.tsi_so_inventory i
  where i.store_code=p_store and exists(select 1 from jsonb_array_elements(coalesce(p_teams,'[]'::jsonb)) t
    where public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name))) t;
 return r;
end;$$;

-- 16) Preview pembagian tim: jumlah SKU per tim dan total gabungan
create or replace function public.tsi_so_teams_preview(p_store text, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; teams jsonb; out jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 teams:=public.tsi_so_teams_clean(p_teams);
 if teams is null then return jsonb_build_object('count',0,'teams','[]'::jsonb); end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',t->>'name','count',
   (select count(*) from public.tsi_so_inventory i where i.store_code=p_store and public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name)))),'[]'::jsonb)
 into out from jsonb_array_elements(teams) t;
 return jsonb_build_object('count',jsonb_array_length(public.tsi_so_teams_scope(p_store,teams)),'teams',out);
end;$$;

-- 17) Area per toko (Admin)
create or replace function public.tsi_so_set_store_area(p_store text, p_area text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin yang mengatur area toko.'; end if;
 update public.tsi_so_stores set area=nullif(trim(coalesce(p_area,'')),'') where code=p_store;
 if not found then raise exception 'Toko tidak ditemukan.'; end if;
 return jsonb_build_object('store',p_store,'area',nullif(trim(coalesce(p_area,'')),''));
end;$$;

-- 18) Arsip SO: Admin dan SPV (sesuai area). Ringkasan selisih tetap disimpan untuk dashboard.
create or replace function public.tsi_so_archive_cycle(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; x record;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'APPROVED' then raise exception 'Hanya SO APPROVED yang bisa diarsipkan.'; end if;
 if c.archived_at is not null then raise exception 'SO ini sudah diarsipkan.'; end if;
 select count(*) total_skus,
  count(*) filter(where l.a=l.system_at_start) tally_count,
  count(*) filter(where l.a<>l.system_at_start) variance_count,
  sum(l.system_at_start)::numeric sys_qty,
  sum(abs(l.a-l.system_at_start))::numeric abs_qty_diff,
  sum(l.a-l.system_at_start)::numeric net_qty_diff,
  sum(l.system_at_start*l.unit_cost)::numeric sys_value,
  sum(abs(l.a-l.system_at_start)*l.unit_cost)::numeric abs_value_diff,
  sum(greatest(l.system_at_start-l.a,0)*l.unit_cost)::numeric missing_value,
  sum(greatest(l.a-l.system_at_start,0)*l.unit_cost)::numeric surplus_value
 into x from (
  select s.system_at_start, s.unit_cost, coalesce(s.validated_qty,s.warehouse_qty+s.display_qty) a
  from public.tsi_so_lines s where s.cycle_id=p_cycle) l;
 update public.tsi_so_cycles set archived_at=now(),
  total_skus=x.total_skus, tally_count=x.tally_count, variance_count=x.variance_count,
  sys_qty=x.sys_qty, abs_qty_diff=x.abs_qty_diff, sys_value=x.sys_value, abs_value_diff=x.abs_value_diff,
  net_qty_diff=x.net_qty_diff, missing_value=x.missing_value, surplus_value=x.surplus_value
 where id=p_cycle;
 delete from public.tsi_so_lines where cycle_id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'ARCHIVE',jsonb_build_object('cycle_id',p_cycle,'skus',x.total_skus));
 return jsonb_build_object('cycle_id',p_cycle,'archived_skus',coalesce(x.total_skus,0));
end;$$;

-- Hak akses
revoke all on function public.tsi_so_teams_preview(text,jsonb) from public, anon;
grant execute on function public.tsi_so_teams_preview(text,jsonb) to authenticated;
revoke all on function public.tsi_so_set_store_area(text,text) from public, anon;
grant execute on function public.tsi_so_set_store_area(text,text) to authenticated;
revoke all on function public.tsi_so_archive_cycle(uuid) from public, anon;
grant execute on function public.tsi_so_archive_cycle(uuid) to authenticated;
revoke all on function public.tsi_so_color_of(text) from public;
grant execute on function public.tsi_so_color_of(text) to authenticated;
revoke all on function public.tsi_so_scope_preview(text,text,jsonb) from public, anon;
grant execute on function public.tsi_so_scope_preview(text,text,jsonb) to authenticated;
revoke all on function public.tsi_so_color_stats(text,text) from public, anon;
grant execute on function public.tsi_so_color_stats(text,text) to authenticated;
revoke all on function public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb,jsonb) from public, anon;
grant execute on function public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb,jsonb) to authenticated;
revoke all on function public.tsi_so_schedule_update(uuid,text,date,time,time,text,jsonb,jsonb) from public, anon;
grant execute on function public.tsi_so_schedule_update(uuid,text,date,time,time,text,jsonb,jsonb) to authenticated;
revoke all on function public.tsi_so_schedule_list(text) from public, anon;
grant execute on function public.tsi_so_schedule_list(text) to authenticated;
revoke all on function public.tsi_so_count_page(uuid,integer,integer,text,text,text) from public, anon;
grant execute on function public.tsi_so_count_page(uuid,integer,integer,text,text,text) to authenticated;
revoke all on function public.tsi_so_set_store_spv(text,uuid) from public, anon;
grant execute on function public.tsi_so_set_store_spv(text,uuid) to authenticated;
revoke all on function public.tsi_so_spv_mapping() from public, anon;
grant execute on function public.tsi_so_spv_mapping() to authenticated;
revoke all on function public.tsi_so_categories(text) from public, anon;
grant execute on function public.tsi_so_categories(text) to authenticated;
