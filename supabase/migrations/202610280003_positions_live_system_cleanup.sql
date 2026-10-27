-- Posisi hitung (Display, Reject, Rak Utama, Rak Cadangan), alasan wajib saat selisih,
-- system qty ikut inventory terbaru (tanpa kunci), pemulihan retail_price, dan pembersihan database.
-- Jalankan SETELAH 202610280002_rules_teams_access.sql. Aman dijalankan ulang.

-- 1) Kolom posisi
alter table public.tsi_so_lines
 add column if not exists pos_display bigint,
 add column if not exists pos_reject bigint,
 add column if not exists pos_rak_utama bigint,
 add column if not exists pos_rak_cadangan bigint;

-- Salin data lama (Gudang -> Rak Utama, Display -> Display). Baris yang lengkap diberi Reject & Rak Cadangan 0.
-- Hanya dijalankan bila kolom lama masih ada (database yang sudah membersihkan kolom lama dilewati).
do $backfill$
begin
 if exists (select 1 from information_schema.columns where table_schema='public' and table_name='tsi_so_lines' and column_name='warehouse_qty')
  and exists (select 1 from information_schema.columns where table_schema='public' and table_name='tsi_so_lines' and column_name='display_qty') then
  execute $q$
   update public.tsi_so_lines set
    pos_display=display_qty,
    pos_rak_utama=warehouse_qty,
    pos_reject=case when warehouse_qty is not null and display_qty is not null then 0 end,
    pos_rak_cadangan=case when warehouse_qty is not null and display_qty is not null then 0 end
   where pos_display is null and pos_rak_utama is null and (warehouse_qty is not null or display_qty is not null)
  $q$;
 end if;
end $backfill$;

-- 2) Total fisik: hanya valid bila keempat posisi sudah diisi (0 tetap dihitung)
create or replace function public.tsi_so_actual(l public.tsi_so_lines)
returns bigint language sql immutable as $$
 select case when l.pos_display is null or l.pos_reject is null or l.pos_rak_utama is null or l.pos_rak_cadangan is null then null
   else l.pos_display+l.pos_reject+l.pos_rak_utama+l.pos_rak_cadangan end
$$;

-- 3) Counting: store tidak melihat system; status hanya TALLY / SELISIH / BELUM
create or replace function public.tsi_so_count_page(p_cycle uuid,p_offset integer default 0,p_limit integer default 50,p_search text default '',p_filter text default 'ALL',p_team text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; n integer; body jsonb; teams jsonb; r text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if p_limit not between 1 and 100 or p_offset<0 then raise exception 'Pagination tidak valid.'; end if;
 if length(p_search)>120 then raise exception 'Pencarian terlalu panjang.'; end if;
 if p_filter not in ('ALL','PENDING','DONE','SELISIH','TALLY') then raise exception 'Filter tidak sah.'; end if;
 select count(*) into n from public.tsi_so_lines l where
  l.cycle_id=p_cycle
   and (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%')
   and (p_team is null or l.team=p_team)
   and (p_filter='ALL'
    or (p_filter='PENDING' and public.tsi_so_actual(l) is null)
    or (p_filter='DONE' and public.tsi_so_actual(l) is not null)
    or (p_filter='SELISIH' and public.tsi_so_actual(l) is not null and public.tsi_so_actual(l)<>l.system_at_start)
    or (p_filter='TALLY' and public.tsi_so_actual(l) is not null and public.tsi_so_actual(l)=l.system_at_start));
 select coalesce(jsonb_agg(q.z order by q.sku),'[]'::jsonb) into body from (
  select l.sku, jsonb_build_object('sku',l.sku,'name',l.item_name,'category',l.category,'team',l.team,
   'display',l.pos_display,'reject',l.pos_reject,'rak_utama',l.pos_rak_utama,'rak_cadangan',l.pos_rak_cadangan,
   'total',public.tsi_so_actual(l),'reason',l.store_note,
   'status',case when public.tsi_so_actual(l) is null then 'BELUM'
     when public.tsi_so_actual(l)=l.system_at_start then 'TALLY' else 'SELISIH' end) z
  from public.tsi_so_lines l where
  l.cycle_id=p_cycle
   and (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%')
   and (p_team is null or l.team=p_team)
   and (p_filter='ALL'
    or (p_filter='PENDING' and public.tsi_so_actual(l) is null)
    or (p_filter='DONE' and public.tsi_so_actual(l) is not null)
    or (p_filter='SELISIH' and public.tsi_so_actual(l) is not null and public.tsi_so_actual(l)<>l.system_at_start)
    or (p_filter='TALLY' and public.tsi_so_actual(l) is not null and public.tsi_so_actual(l)=l.system_at_start))
  order by l.sku limit p_limit offset p_offset) q;
 select coalesce(jsonb_agg(z.t order by z.t),'[]'::jsonb) into teams
 from (select distinct l.team t from public.tsi_so_lines l where l.cycle_id=p_cycle and l.team<>'') z;
 return jsonb_build_object('cycle_id',c.id,'store_code',c.store_code,'status',c.status,'total_filtered',n,'items',body,'teams',teams);
end;$$;

create or replace function public.tsi_so_save_counts(p_cycle uuid,p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; r text; j jsonb; cnt int:=0; v_sku text; k text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('store','admin','spv') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO terkunci atau akses tidak diizinkan.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 then
  raise exception 'Simpan 1-100 SKU per batch.'; end if;
 for j in select value from jsonb_array_elements(p_rows) loop
  v_sku:=upper(trim(coalesce(j->>'sku','')));
  foreach k in array array['display','reject','rak_utama','rak_cadangan'] loop
   if nullif(j->>k,'') is not null and (j->>k) !~ '^[0-9]{1,12}$' then
    raise exception 'Qty % harus bilangan bulat >= 0.',k; end if;
  end loop;
  if length(coalesce(j->>'reason',''))>500 then raise exception 'Alasan maksimal 500 karakter.'; end if;
  update public.tsi_so_lines set
    pos_display=nullif(j->>'display','')::bigint, pos_reject=nullif(j->>'reject','')::bigint,
    pos_rak_utama=nullif(j->>'rak_utama','')::bigint, pos_rak_cadangan=nullif(j->>'rak_cadangan','')::bigint,
    store_note=left(trim(coalesce(j->>'reason','')),500), updated_at=now(), updated_by=auth.uid()
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
declare c public.tsi_so_cycles%rowtype; r text; pending integer; no_reason integer;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('store','admin','spv') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO tidak dapat disubmit.'; end if;
 select count(*) into pending from public.tsi_so_lines l where l.cycle_id=p_cycle and public.tsi_so_actual(l) is null;
 if pending>0 then raise exception 'Masih ada % SKU yang posisinya belum lengkap. Isi 0 jika kosong.',pending; end if;
 select count(*) into no_reason from public.tsi_so_lines l where l.cycle_id=p_cycle
  and public.tsi_so_actual(l)<>l.system_at_start and trim(l.store_note)='';
 if no_reason>0 then raise exception '% SKU selisih wajib diisi alasannya sebelum submit.',no_reason; end if;
 update public.tsi_so_cycles set status='SUBMITTED',submitted_at=now() where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SUBMIT',jsonb_build_object('cycle_id',p_cycle));
 return 'SUBMITTED';
end;$$;

-- 4) Validasi SPV: system terbaru, posisi, total, status, alasan store, dan qty SPV
create or replace function public.tsi_so_validation_page(p_cycle uuid,p_offset integer default 0,p_limit integer default 50,p_search text default '',p_filter text default 'ALL')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; body jsonb; n integer; sm jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'Pagination salah.'; end if;
 if p_filter not in ('ALL','VARIANCE') then raise exception 'Filter tidak sah.'; end if;
 if length(p_search)>120 then raise exception 'Pencarian terlalu panjang.'; end if;
 select count(*) into n from public.tsi_so_lines l where l.cycle_id=p_cycle
  and (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%')
  and (p_filter='ALL' or (public.tsi_so_actual(l) is not null and coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start));
 select jsonb_build_object(
  'total_skus',count(*),
  'missing_skus',count(*) filter(where public.tsi_so_actual(l) is null),
  'variance_skus',count(*) filter(where public.tsi_so_actual(l) is not null and coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start),
  'tally_skus',count(*) filter(where public.tsi_so_actual(l) is not null and coalesce(l.validated_qty,public.tsi_so_actual(l))=l.system_at_start),
  'blocking_skus',count(*) filter(where public.tsi_so_actual(l) is null or
     (coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start and trim(l.spv_note)='' and trim(l.store_note)='')))
 into sm from public.tsi_so_lines l where l.cycle_id=p_cycle;
 select coalesce(jsonb_agg(q.z order by q.sku),'[]'::jsonb) into body from (
  select l.sku, jsonb_build_object('sku',l.sku,'name',l.item_name,'category',l.category,'team',l.team,
   'system',l.system_at_start,'display',l.pos_display,'reject',l.pos_reject,'rak_utama',l.pos_rak_utama,'rak_cadangan',l.pos_rak_cadangan,
   'total',public.tsi_so_actual(l),'validated_qty',l.validated_qty,'store_note',l.store_note,'spv_note',l.spv_note,
   'delta',case when public.tsi_so_actual(l) is null then null else coalesce(l.validated_qty,public.tsi_so_actual(l))-l.system_at_start end,
   'status',case when public.tsi_so_actual(l) is null then 'BELUM'
     when coalesce(l.validated_qty,public.tsi_so_actual(l))=l.system_at_start then 'TALLY' else 'SELISIH' end) z
  from public.tsi_so_lines l
  where l.cycle_id=p_cycle
   and (p_search='' or l.sku ilike '%'||p_search||'%' or l.item_name ilike '%'||p_search||'%')
   and (p_filter='ALL' or (public.tsi_so_actual(l) is not null and coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start))
  order by l.sku limit p_limit offset p_offset) q;
 return jsonb_build_object('status',c.status,'store_code',c.store_code,'cycle_id',c.id,
  'total_filtered',n,'summary',sm,'items',body);
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
  (public.tsi_so_actual(l) is null or
   (coalesce(l.validated_qty,public.tsi_so_actual(l))<>l.system_at_start and trim(l.spv_note)='' and trim(l.store_note)=''));
 if missing>0 then raise exception '% SKU belum lengkap atau selisih belum memiliki alasan.',missing; end if;
 update public.tsi_so_cycles set status='APPROVED',approved_at=now(),approved_by=auth.uid() where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'APPROVE',jsonb_build_object('cycle_id',p_cycle));
 return 'APPROVED';
end;$$;

create or replace function public.tsi_so_export(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; body jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'APPROVED' or c.archived_at is not null then raise exception 'Export hanya untuk SO APPROVED yang belum diarsipkan.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('SKU',l.sku,'NAME_VARIANT',l.item_name,'CATEGORY',l.category,'TEAM',l.team,
 'SYSTEM_AT_START',l.system_at_start,'DISPLAY',l.pos_display,'REJECT',l.pos_reject,'RAK_UTAMA',l.pos_rak_utama,'RAK_CADANGAN',l.pos_rak_cadangan,
 'ACTUAL',coalesce(l.validated_qty,public.tsi_so_actual(l)),
 'ADJUSTMENT',coalesce(l.validated_qty,public.tsi_so_actual(l))-l.system_at_start,'UNIT_COST',l.unit_cost,
 'REASON',coalesce(nullif(l.spv_note,''),l.store_note)) order by l.sku),'[]'::jsonb) into body
 from public.tsi_so_lines l where l.cycle_id=p_cycle;
 return body;
end;$$;

-- 5) Upload: inventory tidak dikunci. Retail dipulihkan. System qty SO aktif ikut diperbarui.
create or replace function public.tsi_so_upload(p_store text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_count integer; v_bad integer; v_id uuid; v_synced integer;
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
    or coalesce(nullif(j->>'cost',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
    or coalesce(nullif(j->>'retail',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
 if v_bad > 0 then raise exception 'Ada % baris tidak valid (SKU, nama, ending, cost, retail).',v_bad; end if;
 select count(*) into v_bad from (select upper(trim(j->>'sku')) sku from jsonb_array_elements(p_rows) j group by 1 having count(*)>1) z;
 if v_bad>0 then raise exception 'Ada SKU duplikat: %.',v_bad; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 insert into public.tsi_so_uploads(store_code,uploaded_by,sku_count) values(p_store,auth.uid(),v_count) returning id into v_id;
 delete from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_inventory(store_code,sku,item_name,category,ending,cost,retail_price,upload_id)
 select p_store,upper(trim(j->>'sku')),trim(j->>'name'),left(coalesce(j->>'category',''),120),
 (j->>'ending')::bigint,coalesce(nullif(j->>'cost',''),'0')::numeric,coalesce(nullif(j->>'retail',''),'0')::numeric,v_id
 from jsonb_array_elements(p_rows) j;
 update public.tsi_so_lines l set system_at_start=coalesce((select i.ending from public.tsi_so_inventory i
   where i.store_code=p_store and i.sku=l.sku),0)
 where l.cycle_id in (select c.id from public.tsi_so_cycles c where c.store_code=p_store and c.status in ('COUNTING','RECOUNT','SUBMITTED'));
 get diagnostics v_synced = row_count;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'UPLOAD',jsonb_build_object('upload_id',v_id,'skus',v_count,'synced_lines',v_synced));
 return jsonb_build_object('upload_id',v_id,'sku_count',v_count,'synced_lines',v_synced,
  'message','Inventory aktif diganti. System qty SO yang sedang berjalan ikut diperbarui (stok tidak dikunci).');
end;$$;

-- 6) Arsip massal & statistik database
create or replace function public.tsi_so_archive_cycles(p_cycles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare cid uuid; cnt int:=0; skus bigint:=0; out jsonb;
begin
 if p_cycles is null or coalesce(array_length(p_cycles,1),0)=0 then raise exception 'Pilih minimal satu SO.'; end if;
 if array_length(p_cycles,1)>200 then raise exception 'Maksimal 200 SO per proses.'; end if;
 foreach cid in array p_cycles loop
  out:=public.tsi_so_archive_cycle(cid);
  cnt:=cnt+1; skus:=skus+coalesce((out->>'archived_skus')::bigint,0);
 end loop;
 return jsonb_build_object('archived',cnt,'archived_skus',skus);
end;$$;

create or replace function public.tsi_so_db_stats()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is null then raise exception 'Tidak memiliki akses SO.'; end if;
 return jsonb_build_object(
  'active_lines',(select count(*) from public.tsi_so_lines),
  'open_cycles',(select count(*) from public.tsi_so_cycles where archived_at is null),
  'archived_cycles',(select count(*) from public.tsi_so_cycles where archived_at is not null),
  'inventory_rows',(select count(*) from public.tsi_so_inventory),
  'audit_rows',(select count(*) from public.tsi_so_audit),
  'lines_bytes',pg_catalog.pg_total_relation_size('public.tsi_so_lines'),
  'total_bytes',(select coalesce(sum(pg_catalog.pg_total_relation_size(c.oid)),0)
     from pg_catalog.pg_class c where c.relnamespace='public'::regnamespace and c.relkind='r' and c.relname like 'tsi_so_%'));
end;$$;

-- 7) Fungsi yang hanya berganti referensi kolom (kpi, dashboard, jadwal, arsip) disalin dari versi aktif di bawah ini
-- ==== GENERATED-FUNCTIONS-BEGIN ====
CREATE OR REPLACE FUNCTION public.tsi_so_archive_cycle(p_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  select s.system_at_start, s.unit_cost, coalesce(s.validated_qty,public.tsi_so_actual(s)) a
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

CREATE OR REPLACE FUNCTION public.tsi_so_kpi(p_store text DEFAULT NULL::text, p_type text DEFAULT NULL::text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare u public.tsi_so_users%rowtype; body jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 if p_type is not null and p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 with cyc as (
  select c.* from public.tsi_so_cycles c
  where (p_store is null or c.store_code=p_store)
   and (p_type is null or c.so_type=p_type)
   and (p_from is null or coalesce(c.planned_date,c.started_at::date)>=p_from)
   and (p_to is null or coalesce(c.planned_date,c.started_at::date)<=p_to)
   and (u.role='admin' or (u.role='store' and c.store_code=u.store_code)
    or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=c.store_code)))
 ), m as (
  select cy.status, cy.archived_at, cy.planned_date,
   case when cy.archived_at is not null then coalesce(cy.total_skus,0) else coalesce(x.total,0) end total,
   case when cy.archived_at is not null then coalesce(cy.total_skus,0) else coalesce(x.done,0) end done,
   case when cy.archived_at is not null then coalesce(cy.tally_count,0) else coalesce(x.tally,0) end tally,
   case when cy.archived_at is not null then cy.sys_qty else x.sys_qty end sys_qty,
   case when cy.archived_at is not null then cy.abs_qty_diff else x.abs_qty_diff end abs_qty_diff,
   case when cy.archived_at is not null then cy.net_qty_diff else x.net_qty_diff end net_qty_diff,
   case when cy.archived_at is not null then cy.sys_value else x.sys_value end sys_value,
   case when cy.archived_at is not null then cy.abs_value_diff else x.abs_value_diff end abs_value_diff,
   case when cy.archived_at is not null then cy.missing_value else x.missing_value end missing_value,
   case when cy.archived_at is not null then cy.surplus_value else x.surplus_value end surplus_value
  from cyc cy
  left join lateral (
   select count(*) total, count(z.a) done, count(*) filter(where z.a=z.s) tally,
    sum(z.s)::numeric sys_qty, sum(abs(z.a-z.s))::numeric abs_qty_diff, sum(z.a-z.s)::numeric net_qty_diff,
    sum(z.s*z.c)::numeric sys_value, sum(abs(z.a-z.s)*z.c)::numeric abs_value_diff,
    sum(greatest(z.s-z.a,0)*z.c)::numeric missing_value, sum(greatest(z.a-z.s,0)*z.c)::numeric surplus_value
   from (select l.system_at_start s, l.unit_cost c,
     case when public.tsi_so_actual(l) is not null
       then coalesce(l.validated_qty,public.tsi_so_actual(l)) end a
     from public.tsi_so_lines l where l.cycle_id=cy.id) z
  ) x on true
 )
 select jsonb_build_object(
  'so_total',count(*),
  'so_finished',count(*) filter(where m.status in ('SUBMITTED','APPROVED') or m.archived_at is not null),
  'so_approved',count(*) filter(where m.status='APPROVED' or m.archived_at is not null),
  'so_submitted',count(*) filter(where m.status='SUBMITTED'),
  'so_running',count(*) filter(where m.status in ('COUNTING','RECOUNT')),
  'so_scheduled',count(*) filter(where m.status='SCHEDULED'),
  'so_overdue',count(*) filter(where m.status='SCHEDULED' and m.planned_date<current_date),
  'sku_done',coalesce(sum(m.done) filter(where m.status in ('SUBMITTED','APPROVED') or m.archived_at is not null),0),
  'appr_total',coalesce(sum(m.total) filter(where m.status='APPROVED' or m.archived_at is not null),0),
  'appr_tally',coalesce(sum(m.tally) filter(where m.status='APPROVED' or m.archived_at is not null),0),
  'appr_sys_qty',coalesce(sum(m.sys_qty) filter(where m.status='APPROVED' or m.archived_at is not null),0),
  'appr_abs_qty',coalesce(sum(m.abs_qty_diff) filter(where m.status='APPROVED' or m.archived_at is not null),0),
  'appr_sys_value',coalesce(sum(m.sys_value) filter(where m.status='APPROVED' or m.archived_at is not null),0),
  'appr_abs_value',coalesce(sum(m.abs_value_diff) filter(where m.status='APPROVED' or m.archived_at is not null),0),
  'net_qty_diff',coalesce(sum(m.net_qty_diff) filter(where m.status in ('SUBMITTED','APPROVED') or m.archived_at is not null),0),
  'missing_value',coalesce(sum(m.missing_value) filter(where m.status in ('SUBMITTED','APPROVED') or m.archived_at is not null),0),
  'surplus_value',coalesce(sum(m.surplus_value) filter(where m.status in ('SUBMITTED','APPROVED') or m.archived_at is not null),0),
  'abs_value',coalesce(sum(m.abs_value_diff) filter(where m.status in ('SUBMITTED','APPROVED') or m.archived_at is not null),0)
 ) into body from m;
 return body;
end;$$;

CREATE OR REPLACE FUNCTION public.tsi_so_dashboard()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
 left join lateral (select * from public.tsi_so_cycles x where x.store_code=s.code order by x.started_at desc,x.id desc limit 1) c on true
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


-- 8) Hak akses fungsi baru
revoke all on function public.tsi_so_archive_cycles(uuid[]) from public, anon;
grant execute on function public.tsi_so_archive_cycles(uuid[]) to authenticated;
revoke all on function public.tsi_so_db_stats() from public, anon;
grant execute on function public.tsi_so_db_stats() to authenticated;

-- 9) Kolom lama tidak dipakai lagi (data sudah disalin ke pos_*)
alter table public.tsi_so_lines drop column if exists warehouse_qty, drop column if exists display_qty;
