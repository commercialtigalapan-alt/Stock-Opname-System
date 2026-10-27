-- Paritas fitur dengan aplikasi v164 (menu tetap): edit/hapus jadwal, scope per category,
-- preview jadwal, KPI dashboard, dan arsip yang menyimpan selisih qty & nilai.
-- Jalankan SETELAH 202610270009_accuracy_approved_only.sql. Aman dijalankan ulang.

-- 1) Kolom ringkasan tambahan pada arsip
alter table public.tsi_so_cycles
 add column if not exists net_qty_diff numeric,
 add column if not exists missing_value numeric,
 add column if not exists surplus_value numeric;

-- 2) Arsip: simpan juga selisih bersih, nilai kurang, dan nilai lebih
create or replace function public.tsi_so_archive_cycle(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; c public.tsi_so_cycles%rowtype; x record;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin yang boleh mengarsipkan SO.'; end if;
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
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

-- 3) Helper internal: SKU final untuk Partial SO (gabungan SKU pilihan + semua SKU pada category pilihan)
create or replace function public.tsi_so_scope_skus(p_store text, p_skus jsonb, p_categories text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
 select coalesce(jsonb_agg(t.sku order by t.sku),'[]'::jsonb) into r from (
  select i.sku from public.tsi_so_inventory i
  where i.store_code=p_store and (
   i.sku in (select upper(trim(e.v)) from jsonb_array_elements_text(coalesce(p_skus,'[]'::jsonb)) as e(v))
   or i.category = any(coalesce(p_categories,'{}'::text[])))
 ) t;
 return r;
end;$$;
revoke all on function public.tsi_so_scope_skus(text,jsonb,text[]) from public, anon, authenticated;

-- 4) Daftar category + jumlah SKU per toko (untuk pemilihan Partial SO)
create or replace function public.tsi_so_categories(p_store text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('category',t.category,'count',t.n) order by t.category),'[]'::jsonb) into body
 from (select i.category, count(*) n from public.tsi_so_inventory i where i.store_code=p_store group by i.category) t;
 return body;
end;$$;

-- 5) Preview scope jadwal sebelum disimpan
create or replace function public.tsi_so_scope_preview(p_store text, p_type text, p_skus jsonb, p_categories text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_scope jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 if p_type='GRAND' then
  return jsonb_build_object(
   'count',(select count(*) from public.tsi_so_inventory i where i.store_code=p_store),
   'sample',(select coalesce(jsonb_agg(t.sku),'[]'::jsonb) from (select i.sku from public.tsi_so_inventory i where i.store_code=p_store order by i.sku limit 30) t));
 end if;
 v_scope:=public.tsi_so_scope_skus(p_store,p_skus,p_categories);
 return jsonb_build_object(
  'count',jsonb_array_length(v_scope),
  'sample',(select coalesce(jsonb_agg(t.sku),'[]'::jsonb) from (select e.v sku from jsonb_array_elements_text(v_scope) as e(v) limit 30) t));
end;$$;

-- 6) Buat jadwal (versi baru menerima category)
drop function if exists public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb);
create or replace function public.tsi_so_schedule_create(p_store text, p_type text, p_date date, p_start time, p_end time, p_notes text, p_skus jsonb default null, p_categories text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_scope jsonb;
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
  v_scope:=public.tsi_so_scope_skus(p_store,p_skus,p_categories);
  if jsonb_array_length(v_scope)=0 then raise exception 'Pilih minimal satu category atau SKU untuk Partial SO.'; end if;
 end if;
 insert into public.tsi_so_cycles(store_code,status,started_by,upload_id,so_type,planned_date,start_time,end_time,notes,scope_skus,scheduled_by,scheduled_at)
 values(p_store,'SCHEDULED',auth.uid(),v_upload,p_type,p_date,p_start,p_end,left(coalesce(p_notes,''),500),v_scope,auth.uid(),now())
 returning id into v_id;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'SCHEDULE',jsonb_build_object('cycle_id',v_id,'type',p_type,'date',p_date,'skus',case when p_type='PARTIAL' then jsonb_array_length(v_scope) else v_n end));
 return jsonb_build_object('cycle_id',v_id,'scope_count',case when p_type='PARTIAL' then jsonb_array_length(v_scope) else v_n end);
end;$$;

-- 7) Ubah jadwal (hanya SCHEDULED). Scope lama dipertahankan jika tidak ada pilihan baru.
create or replace function public.tsi_so_schedule_update(p_cycle uuid, p_type text, p_date date, p_start time, p_end time, p_notes text, p_skus jsonb default null, p_categories text[] default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; c public.tsi_so_cycles%rowtype; v_scope jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'Jadwal tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin atau SPV yang mengubah jadwal.'; end if;
 if c.status<>'SCHEDULED' then raise exception 'Hanya jadwal berstatus SCHEDULED yang bisa diubah.'; end if;
 if p_type not in ('GRAND','PARTIAL') then raise exception 'Tipe SO tidak sah.'; end if;
 if p_date is null then raise exception 'Tanggal jadwal wajib diisi.'; end if;
 if p_start is not null and p_end is not null and p_end<=p_start then raise exception 'Jam selesai harus setelah jam mulai.'; end if;
 if p_type='PARTIAL' then
  if p_skus is not null or p_categories is not null then
   v_scope:=public.tsi_so_scope_skus(c.store_code,p_skus,p_categories);
  else
   v_scope:=c.scope_skus;
  end if;
  if v_scope is null or jsonb_array_length(v_scope)=0 then raise exception 'Pilih minimal satu category atau SKU untuk Partial SO.'; end if;
 end if;
 update public.tsi_so_cycles set so_type=p_type, planned_date=p_date, start_time=p_start, end_time=p_end,
  notes=left(coalesce(p_notes,''),500), scope_skus=case when p_type='PARTIAL' then v_scope else null end
 where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SCHEDULE_EDIT',jsonb_build_object('cycle_id',p_cycle,'type',p_type,'date',p_date));
 return jsonb_build_object('cycle_id',p_cycle);
end;$$;

-- 8) Hapus jadwal / SO (satu atau banyak). APPROVED tidak boleh dihapus (gunakan arsip).
create or replace function public.tsi_so_schedule_delete(p_cycles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; c public.tsi_so_cycles%rowtype; v_id uuid; k int:=0;
begin
 if p_cycles is null or array_length(p_cycles,1) is null then raise exception 'Pilih SO yang akan dihapus.'; end if;
 foreach v_id in array p_cycles loop
  select * into c from public.tsi_so_cycles where id=v_id for update;
  if not found then continue; end if;
  r:=public.tsi_so_authorize(c.store_code,true);
  if r not in ('admin','spv') then raise exception 'Hanya Admin atau SPV yang menghapus SO.'; end if;
  if c.archived_at is not null or c.status='APPROVED' then raise exception 'SO yang sudah APPROVED tidak bisa dihapus. Gunakan arsip.'; end if;
  if c.status='SUBMITTED' and r<>'admin' then raise exception 'SO berstatus Validasi SPV hanya bisa dihapus Admin.'; end if;
  delete from public.tsi_so_lines where cycle_id=v_id;
  delete from public.tsi_so_cycles where id=v_id;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
  values(auth.uid(),c.store_code,'DELETE',jsonb_build_object('cycle_id',v_id,'status',c.status,'so_type',c.so_type));
  k:=k+1;
 end loop;
 return jsonb_build_object('deleted',k);
end;$$;

-- 9) Daftar jadwal/SO dengan PIC, jumlah SKU, tally dan variance (dipakai semua menu SO)
create or replace function public.tsi_so_schedule_list(p_store text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; body jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 if u.role='store' then raise exception 'Menu jadwal hanya untuk Admin dan SPV.'; end if;
 if p_store is not null then perform public.tsi_so_authorize(p_store,true); end if;
 select coalesce(jsonb_agg(t.j order by t.pd desc nulls last, t.sa desc),'[]'::jsonb) into body from (
  select c.planned_date pd, c.started_at sa, jsonb_build_object(
   'id',c.id,'store_code',c.store_code,'store_name',s.name,'so_type',c.so_type,'status',c.status,
   'planned_date',c.planned_date,'start_time',c.start_time,'end_time',c.end_time,'notes',c.notes,
   'started_at',c.started_at,'archived',c.archived_at is not null,
   'pic',coalesce(split_part(pu.email,'@',1),''),
   'scope_count',case
     when c.archived_at is not null then coalesce(c.total_skus,0)
     when c.status='SCHEDULED' then case when c.so_type='GRAND'
        then (select count(*) from public.tsi_so_inventory i where i.store_code=c.store_code)
        else jsonb_array_length(coalesce(c.scope_skus,'[]'::jsonb)) end
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
   and (u.role='admin' or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=c.store_code)))
  limit 1000
 ) t;
 return body;
end;$$;

-- 10) KPI dashboard agregat (akurasi hanya dari SO APPROVED; selisih dari SO SUBMITTED/APPROVED)
create or replace function public.tsi_so_kpi(p_store text default null, p_type text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
     case when l.warehouse_qty is not null and l.display_qty is not null
       then coalesce(l.validated_qty,l.warehouse_qty+l.display_qty) end a
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

-- Hak akses
revoke all on function public.tsi_so_archive_cycle(uuid) from public, anon;
grant execute on function public.tsi_so_archive_cycle(uuid) to authenticated;
revoke all on function public.tsi_so_categories(text) from public, anon;
grant execute on function public.tsi_so_categories(text) to authenticated;
revoke all on function public.tsi_so_scope_preview(text,text,jsonb,text[]) from public, anon;
grant execute on function public.tsi_so_scope_preview(text,text,jsonb,text[]) to authenticated;
revoke all on function public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb,text[]) from public, anon;
grant execute on function public.tsi_so_schedule_create(text,text,date,time,time,text,jsonb,text[]) to authenticated;
revoke all on function public.tsi_so_schedule_update(uuid,text,date,time,time,text,jsonb,text[]) from public, anon;
grant execute on function public.tsi_so_schedule_update(uuid,text,date,time,time,text,jsonb,text[]) to authenticated;
revoke all on function public.tsi_so_schedule_delete(uuid[]) from public, anon;
grant execute on function public.tsi_so_schedule_delete(uuid[]) to authenticated;
revoke all on function public.tsi_so_schedule_list(text) from public, anon;
grant execute on function public.tsi_so_schedule_list(text) to authenticated;
revoke all on function public.tsi_so_kpi(text,text,date,date) from public, anon;
grant execute on function public.tsi_so_kpi(text,text,date,date) to authenticated;
