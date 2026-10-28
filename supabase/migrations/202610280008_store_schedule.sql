-- 202610280008: Store bisa membuat, mengubah, dan menghapus jadwal SO toko sendiri (hanya status SCHEDULED).
-- Jalankan SETELAH 202610280007_fix_store_name_polman.sql. Aman dijalankan ulang.

-- dari 202610280002_rules_teams_access.sql, hanya aturan role Store yang diubah
create or replace function public.tsi_so_scope_preview(p_store text, p_type text, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; rule jsonb:=public.tsi_so_clean_rule(p_rule); v jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
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

-- dari 202610280005_sku_rounds_final_qty.sql, hanya aturan role Store yang diubah
create or replace function public.tsi_so_color_stats(p_store text, p_category text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 with inv as (
   select public.tsi_so_color_name(i.item_name,i.category) color, i.sku,
     (i.sku in (select * from public.tsi_so_eligible(p_store))) elig
   from public.tsi_so_inventory i
   where i.store_code=p_store and i.category=p_category),
 cnt as (select color, count(*) sku_count, count(*) filter(where elig) eligible_count from inv group by color),
 cy as (select c.id, c.planned_date, c.scope_skus from public.tsi_so_cycles c
   where c.store_code=p_store and c.status<>'SCHEDULED'),
 hit as (select cy.id, cy.planned_date, inv.color from cy join inv
   on (cy.scope_skus is null or inv.sku in (select jsonb_array_elements_text(cy.scope_skus)))),
 st as (select color, count(distinct id) so_count, max(planned_date) last_date from hit group by color)
 select coalesce(jsonb_agg(jsonb_build_object('color',cnt.color,'sku_count',cnt.sku_count,'eligible_count',cnt.eligible_count,
   'so_count',coalesce(st.so_count,0),'last_date',st.last_date) order by cnt.sku_count desc, cnt.color),'[]'::jsonb) into body
 from cnt left join st on st.color=cnt.color;
 return body;
end;$$;

-- dari 202610280005_sku_rounds_final_qty.sql, hanya aturan role Store yang diubah
create or replace function public.tsi_so_teams_preview(p_store text, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; teams jsonb; out jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 teams:=public.tsi_so_teams_clean(p_teams);
 if teams is null then return jsonb_build_object('count',0,'teams','[]'::jsonb); end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',t->>'name','count',
   (select count(*) from public.tsi_so_inventory i where i.store_code=p_store
     and i.sku in (select * from public.tsi_so_eligible(p_store))
     and public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name)))),'[]'::jsonb)
 into out from jsonb_array_elements(teams) t;
 return jsonb_build_object('count',jsonb_array_length(public.tsi_so_teams_scope(p_store,teams)),'teams',out);
end;$$;

-- dari 202610280002_rules_teams_access.sql, hanya aturan role Store yang diubah
create or replace function public.tsi_so_schedule_create(p_store text, p_type text, p_date date, p_start time, p_end time, p_notes text, p_rule jsonb default null, p_teams jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_id uuid; v_upload uuid; v_n int; v_rule jsonb; v_scope jsonb; v_teams jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
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

-- dari 202610280002_rules_teams_access.sql, hanya aturan role Store yang diubah
create or replace function public.tsi_so_schedule_update(p_cycle uuid, p_type text, p_date date, p_start time, p_end time, p_notes text, p_rule jsonb default null, p_teams jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; c public.tsi_so_cycles%rowtype; v_rule jsonb; v_scope jsonb; v_teams jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'Jadwal tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
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

-- dari 202610280001_app_parity.sql, hanya aturan role Store yang diubah
create or replace function public.tsi_so_schedule_delete(p_cycles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; c public.tsi_so_cycles%rowtype; v_id uuid; k int:=0;
begin
 if p_cycles is null or array_length(p_cycles,1) is null then raise exception 'Pilih SO yang akan dihapus.'; end if;
 foreach v_id in array p_cycles loop
  select * into c from public.tsi_so_cycles where id=v_id for update;
  if not found then continue; end if;
  r:=public.tsi_so_authorize(c.store_code,true);
  if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
  if c.archived_at is not null or c.status='APPROVED' then raise exception 'SO yang sudah APPROVED tidak bisa dihapus. Gunakan arsip.'; end if;
  if r='store' and c.status<>'SCHEDULED' then raise exception 'Store hanya bisa menghapus jadwal yang belum diproses.'; end if;
  if c.status='SUBMITTED' and r<>'admin' then raise exception 'SO berstatus Validasi SPV hanya bisa dihapus Admin.'; end if;
  delete from public.tsi_so_lines where cycle_id=v_id;
  delete from public.tsi_so_cycles where id=v_id;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
  values(auth.uid(),c.store_code,'DELETE',jsonb_build_object('cycle_id',v_id,'status',c.status,'so_type',c.so_type));
  k:=k+1;
 end loop;
 return jsonb_build_object('deleted',k);
end;$$;

