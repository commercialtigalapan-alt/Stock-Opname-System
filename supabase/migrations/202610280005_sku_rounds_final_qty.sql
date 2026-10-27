-- 202610280005: (1) status validasi memakai angka final (SPV Qty bila diisi, jika kosong total Store),
-- (2) rasio SKU per toko: setiap SKU harus ter-SO sekali sebelum boleh di-SO lagi,
-- (3) Cakupan SKU (menu khusus) dan jumlah 'bisa dipilih' per warna.
-- Jalankan setelah 202610280004_color_status_analytics.sql. Aman dijalankan ulang.

-- 1) Rasio SKU (tahan arsip: tidak bergantung pada baris detail SO)
create table if not exists public.tsi_so_sku_rounds(
 store_code text not null references public.tsi_so_stores(code),
 sku text not null,
 so_count integer not null default 0 check (so_count>=0),
 last_date date,
 primary key(store_code,sku));
alter table public.tsi_so_sku_rounds enable row level security;
revoke all on public.tsi_so_sku_rounds from anon, authenticated;

alter table public.tsi_so_cycles add column if not exists rounds_recorded boolean not null default false;

-- Isi awal dari SO yang sudah selesai dan belum diarsipkan (SO lama yang sudah diarsipkan tidak bisa dihitung ulang).
insert into public.tsi_so_sku_rounds(store_code,sku,so_count,last_date)
select c.store_code,l.sku,count(*),max(coalesce(c.planned_date,c.started_at::date))
from public.tsi_so_lines l join public.tsi_so_cycles c on c.id=l.cycle_id
where c.status in ('SUBMITTED','APPROVED') and c.archived_at is null
group by c.store_code,l.sku
on conflict (store_code,sku) do nothing;
update public.tsi_so_cycles set rounds_recorded=true where status in ('SUBMITTED','APPROVED');

-- Rasio per SKU untuk satu toko (termasuk SKU yang belum pernah di-SO = 0)
create or replace function public.tsi_so_rounds(p_store text)
returns table(sku text, item_name text, category text, so_count integer)
language sql stable security definer set search_path = '' as $$
 select i.sku, i.item_name, i.category, coalesce(r.so_count,0)::integer
 from public.tsi_so_inventory i
 left join public.tsi_so_sku_rounds r on r.store_code=i.store_code and r.sku=i.sku
 where i.store_code=p_store
$$;
revoke all on function public.tsi_so_rounds(text) from public, anon, authenticated;

-- SKU yang boleh dipilih sekarang: rasio terendah toko (semua SKU harus naik ke rasio ini dulu)
create or replace function public.tsi_so_eligible(p_store text)
returns setof text language sql stable security definer set search_path = '' as $$
 select e.sku from public.tsi_so_rounds(p_store) e
 where e.so_count=(select coalesce(min(x.so_count),0) from public.tsi_so_rounds(p_store) x)
$$;
revoke all on function public.tsi_so_eligible(text) from public, anon, authenticated;

-- 2) Pemilihan scope: hanya SKU yang bisa dipilih (Grand tanpa pilihan = seluruh SKU, tidak dibatasi)
create or replace function public.tsi_so_scope_skus(p_store text, p_rule jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
 select coalesce(jsonb_agg(t.sku order by t.sku),'[]'::jsonb) into r from (
  select i.sku from public.tsi_so_inventory i
  where i.store_code=p_store and public.tsi_so_rule_match(p_rule,i.sku,i.category,i.item_name)
    and i.sku in (select * from public.tsi_so_eligible(p_store))) t;
 return r;
end;$$;

create or replace function public.tsi_so_teams_scope(p_store text, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r jsonb;
begin
 select coalesce(jsonb_agg(t.sku order by t.sku),'[]'::jsonb) into r from (
  select i.sku from public.tsi_so_inventory i
  where i.store_code=p_store
    and i.sku in (select * from public.tsi_so_eligible(p_store))
    and exists(select 1 from jsonb_array_elements(coalesce(p_teams,'[]'::jsonb)) t
      where public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name))) t;
 return r;
end;$$;

create or replace function public.tsi_so_teams_preview(p_store text, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; teams jsonb; out jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 teams:=public.tsi_so_teams_clean(p_teams);
 if teams is null then return jsonb_build_object('count',0,'teams','[]'::jsonb); end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',t->>'name','count',
   (select count(*) from public.tsi_so_inventory i where i.store_code=p_store
     and i.sku in (select * from public.tsi_so_eligible(p_store))
     and public.tsi_so_rule_match(t->'rule',i.sku,i.category,i.item_name)))),'[]'::jsonb)
 into out from jsonb_array_elements(teams) t;
 return jsonb_build_object('count',jsonb_array_length(public.tsi_so_teams_scope(p_store,teams)),'teams',out);
end;$$;

-- 3) Submit: rasio SKU dicatat sekali per SO (resubmit setelah recount tidak menambah rasio lagi)
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
 if not c.rounds_recorded then
  insert into public.tsi_so_sku_rounds(store_code,sku,so_count,last_date)
  select c.store_code,l.sku,1,coalesce(c.planned_date,c.started_at::date) from public.tsi_so_lines l where l.cycle_id=p_cycle
  on conflict (store_code,sku) do update set so_count=public.tsi_so_sku_rounds.so_count+1, last_date=excluded.last_date;
  update public.tsi_so_cycles set rounds_recorded=true where id=p_cycle;
 end if;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SUBMIT',jsonb_build_object('cycle_id',p_cycle));
 return 'SUBMITTED';
end;$$;

-- 4) Validasi: status & selisih memakai angka final (SPV Qty jika diisi, jika kosong total Store)
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

-- 5) Warna: jumlah SKU yang bisa dipilih sekarang dan yang masih terkunci (sudah di-SO di putaran ini)
create or replace function public.tsi_so_color_stats(p_store text, p_category text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
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

-- 6) Menu Cakupan SKU: rasio tiap SKU, status sudah/belum di-SO, dan bisa dipilih atau terkunci
create or replace function public.tsi_so_sku_coverage(p_store text, p_filter text default 'ALL', p_search text default '', p_offset integer default 0, p_limit integer default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; mn integer; sm jsonb; n integer; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if p_filter not in ('ALL','BELUM','SUDAH','DIPILIH','TERKUNCI') then raise exception 'Filter tidak sah.'; end if;
 if p_offset<0 or p_limit not between 1 and 100 then raise exception 'Pagination salah.'; end if;
 if length(p_search)>120 then raise exception 'Pencarian terlalu panjang.'; end if;
 select coalesce(min(e.so_count),0) into mn from public.tsi_so_rounds(p_store) e;
 select jsonb_build_object('total',count(*),'belum',count(*) filter(where e.so_count=0),'sudah',count(*) filter(where e.so_count>0),
   'dipilih',count(*) filter(where e.so_count=mn),'terkunci',count(*) filter(where e.so_count>mn),
   'min_ratio',coalesce(min(e.so_count),0),'max_ratio',coalesce(max(e.so_count),0))
 into sm from public.tsi_so_rounds(p_store) e;
 select count(*) into n from public.tsi_so_rounds(p_store) e
  where (p_search='' or e.sku ilike '%'||p_search||'%' or e.item_name ilike '%'||p_search||'%')
   and (p_filter='ALL' or (p_filter='BELUM' and e.so_count=0) or (p_filter='SUDAH' and e.so_count>0)
        or (p_filter='DIPILIH' and e.so_count=mn) or (p_filter='TERKUNCI' and e.so_count>mn));
 select coalesce(jsonb_agg(q.z order by q.sku),'[]'::jsonb) into body from (
  select e.sku, jsonb_build_object('sku',e.sku,'name',e.item_name,'category',e.category,'ratio',e.so_count,
    'eligible',e.so_count=mn,'status',case when e.so_count=0 then 'BELUM' else 'SUDAH' end) z
  from public.tsi_so_rounds(p_store) e
  where (p_search='' or e.sku ilike '%'||p_search||'%' or e.item_name ilike '%'||p_search||'%')
   and (p_filter='ALL' or (p_filter='BELUM' and e.so_count=0) or (p_filter='SUDAH' and e.so_count>0)
        or (p_filter='DIPILIH' and e.so_count=mn) or (p_filter='TERKUNCI' and e.so_count>mn))
  order by e.sku limit p_limit offset p_offset) q;
 return jsonb_build_object('total_filtered',n,'summary',sm,'items',body);
end;$$;

revoke all on function public.tsi_so_scope_skus(text,jsonb) from public, anon;
revoke all on function public.tsi_so_teams_scope(text,jsonb) from public, anon;
revoke all on function public.tsi_so_teams_preview(text,jsonb) from public, anon;
grant execute on function public.tsi_so_teams_preview(text,jsonb) to authenticated;
revoke all on function public.tsi_so_color_stats(text,text) from public, anon;
grant execute on function public.tsi_so_color_stats(text,text) to authenticated;
revoke all on function public.tsi_so_sku_coverage(text,text,text,integer,integer) from public, anon;
grant execute on function public.tsi_so_sku_coverage(text,text,text,integer,integer) to authenticated;
revoke all on function public.tsi_so_submit(uuid) from public, anon;
grant execute on function public.tsi_so_submit(uuid) to authenticated;
revoke all on function public.tsi_so_validation_page(uuid,integer,integer,text,text) from public, anon;
grant execute on function public.tsi_so_validation_page(uuid,integer,integer,text,text) to authenticated;
