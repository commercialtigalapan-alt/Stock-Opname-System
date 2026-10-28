-- 202610280013: Berita Acara (BA) SO dengan approval berjenjang (SPV lalu Manager) dan tanda adjust per BA.
-- Jalankan SETELAH 202610280012_hard_delete_approved.sql. Aman dijalankan ulang.

create sequence if not exists public.tsi_so_ba_seq;

create table if not exists public.tsi_so_ba (
 id uuid primary key default gen_random_uuid(),
 ba_no text not null unique,
 cycle_id uuid not null unique references public.tsi_so_cycles(id),
 store_code text not null references public.tsi_so_stores(code),
 created_at timestamptz not null default now(),
 created_by uuid references auth.users(id),
 created_name text not null default '',
 summary jsonb not null default '{}'::jsonb,
 spv_at timestamptz, spv_by uuid references auth.users(id), spv_name text,
 mgr_at timestamptz, mgr_by uuid references auth.users(id), mgr_name text,
 adj_at timestamptz, adj_by uuid references auth.users(id), adj_name text
);
create index if not exists tsi_so_ba_store on public.tsi_so_ba(store_code, created_at desc);
alter table public.tsi_so_ba enable row level security;

create or replace function public.tsi_so_ba_name(p_uid uuid)
returns text language sql stable security definer set search_path = '' as $$
 select coalesce(nullif(btrim(u.full_name),''), u.email, '') from public.tsi_so_users u where u.user_id = p_uid
$$;

-- Buat BA dari SO APPROVED. Ringkasan dihitung sekali lalu disimpan (snapshot).
create or replace function public.tsi_so_ba_create(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; b public.tsi_so_ba%rowtype; s jsonb; seq bigint; rn text; yr int; bano text;
begin
 select * into c from public.tsi_so_cycles where id = p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 select * into b from public.tsi_so_ba where cycle_id = p_cycle;
 if found then return jsonb_build_object('id', b.id, 'ba_no', b.ba_no, 'existed', true); end if;
 if c.status <> 'APPROVED' then raise exception 'BA hanya bisa dibuat untuk SO yang sudah APPROVED.'; end if;
 if c.archived_at is not null then raise exception 'SO sudah dibersihkan. Buat BA sebelum membersihkan SO.'; end if;

 select jsonb_build_object(
  'total_skus', count(*),
  'tally_count', count(*) filter (where a = system_at_start),
  'variance_count', count(*) filter (where a <> system_at_start),
  'sys_qty', coalesce(sum(system_at_start),0),
  'net_qty', coalesce(sum(a - system_at_start),0),
  'abs_qty', coalesce(sum(abs(a - system_at_start)),0),
  'missing_value', coalesce(sum(greatest(system_at_start - a, 0) * unit_cost),0),
  'surplus_value', coalesce(sum(greatest(a - system_at_start, 0) * unit_cost),0))
 into s
 from (select l0.system_at_start, l0.unit_cost, coalesce(l0.validated_qty, public.tsi_so_actual(l0)) a
       from public.tsi_so_lines l0 where l0.cycle_id = p_cycle) l;

 seq := nextval('public.tsi_so_ba_seq');
 rn := (array['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'])[extract(month from (now() at time zone 'Asia/Makassar'))::int];
 yr := extract(year from (now() at time zone 'Asia/Makassar'))::int;
 bano := 'BA/' || c.store_code || '/' || lpad(seq::text, 4, '0') || '/' || rn || '/' || yr;

 insert into public.tsi_so_ba(ba_no, cycle_id, store_code, created_by, created_name, summary)
 values (bano, p_cycle, c.store_code, auth.uid(), public.tsi_so_ba_name(auth.uid()), s)
 returning * into b;

 insert into public.tsi_so_audit(user_id, store_code, event, meta)
 values (auth.uid(), c.store_code, 'BA_CREATE', jsonb_build_object('ba_id', b.id, 'ba_no', bano, 'cycle_id', p_cycle));
 return jsonb_build_object('id', b.id, 'ba_no', bano, 'existed', false);
end;$$;

-- Tanda tangan berjenjang: SPV dulu, lalu Manager (Admin) yang berbeda orang dari SPV.
create or replace function public.tsi_so_ba_sign(p_ba uuid, p_level text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; r text;
begin
 select * into b from public.tsi_so_ba where id = p_ba for update;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 if p_level = 'SPV' then
  perform public.tsi_so_require_spv(b.store_code);
  if b.spv_at is not null then raise exception 'BA sudah ditandatangani SPV.'; end if;
  update public.tsi_so_ba set spv_at = now(), spv_by = auth.uid(), spv_name = public.tsi_so_ba_name(auth.uid()) where id = p_ba;
 elsif p_level = 'MGR' then
  select u.role into r from public.tsi_so_users u where u.user_id = auth.uid() and u.active;
  if r is distinct from 'admin' then raise exception 'Persetujuan Manager hanya untuk akun Manager.' using errcode = '42501'; end if;
  if b.spv_at is null then raise exception 'BA harus ditandatangani SPV dahulu.'; end if;
  if b.mgr_at is not null then raise exception 'BA sudah disetujui Manager.'; end if;
  if b.spv_by = auth.uid() then raise exception 'Manager harus orang yang berbeda dari SPV penanda tangan.'; end if;
  update public.tsi_so_ba set mgr_at = now(), mgr_by = auth.uid(), mgr_name = public.tsi_so_ba_name(auth.uid()) where id = p_ba;
 else
  raise exception 'Level tanda tangan tidak dikenal.';
 end if;
 insert into public.tsi_so_audit(user_id, store_code, event, meta)
 values (auth.uid(), b.store_code, 'BA_SIGN', jsonb_build_object('ba_id', p_ba, 'ba_no', b.ba_no, 'level', p_level));
 return jsonb_build_object('id', p_ba, 'level', p_level);
end;$$;

-- Tandai BA sudah di-adjust di sistem (hanya setelah disetujui Manager).
create or replace function public.tsi_so_ba_adjust(p_ba uuid, p_done boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype;
begin
 select * into b from public.tsi_so_ba where id = p_ba for update;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(b.store_code);
 if b.mgr_at is null then raise exception 'BA harus disetujui Manager sebelum ditandai adjust.'; end if;
 if coalesce(p_done, false) then
  update public.tsi_so_ba set adj_at = now(), adj_by = auth.uid(), adj_name = public.tsi_so_ba_name(auth.uid()) where id = p_ba;
 else
  update public.tsi_so_ba set adj_at = null, adj_by = null, adj_name = null where id = p_ba;
 end if;
 insert into public.tsi_so_audit(user_id, store_code, event, meta)
 values (auth.uid(), b.store_code, 'BA_ADJUST', jsonb_build_object('ba_id', p_ba, 'ba_no', b.ba_no, 'done', coalesce(p_done, false)));
 return jsonb_build_object('id', p_ba, 'done', coalesce(p_done, false));
end;$$;

-- Daftar BA. Store tidak punya akses. SPV hanya tokonya, Admin semua.
create or replace function public.tsi_so_ba_list(p_store text default null, p_status text default 'ALL', p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.tsi_so_users%rowtype; r jsonb;
begin
 select * into me from public.tsi_so_users where user_id = auth.uid() and active;
 if not found or me.role = 'store' then raise exception 'Tidak memiliki akses BA.' using errcode = '42501'; end if;
 if p_store is not null then perform public.tsi_so_require_spv(p_store); end if;
 select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r from (
  select b.id, b.ba_no, b.store_code, st.name as store_name, b.created_at, b.created_name, b.summary,
         b.spv_at, b.spv_name, b.mgr_at, b.mgr_name, b.adj_at, b.adj_name
  from public.tsi_so_ba b join public.tsi_so_stores st on st.code = b.store_code
  where (p_store is null or b.store_code = p_store)
    and (me.role = 'admin' or exists(select 1 from public.tsi_so_spv_stores a where a.user_id = me.user_id and a.store_code = b.store_code))
    and (coalesce(p_status,'ALL') = 'ALL'
      or (p_status = 'WAIT_SPV' and b.spv_at is null)
      or (p_status = 'WAIT_MGR' and b.spv_at is not null and b.mgr_at is null)
      or (p_status = 'WAIT_ADJ' and b.mgr_at is not null and b.adj_at is null)
      or (p_status = 'ADJUSTED' and b.adj_at is not null))
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
 ) x;
 return r;
end;$$;

-- Detail BA: header, ringkasan, dan daftar SKU yang selisih (urut selisih terbesar, maks 300 baris).
create or replace function public.tsi_so_ba_get(p_ba uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; hdr jsonb; ln jsonb;
begin
 select * into b from public.tsi_so_ba where id = p_ba;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(b.store_code);
 select jsonb_build_object('id', b.id, 'ba_no', b.ba_no, 'store_code', b.store_code,
   'store_name', st.name, 'created_at', b.created_at, 'created_name', b.created_name,
   'spv_at', b.spv_at, 'spv_name', b.spv_name, 'mgr_at', b.mgr_at, 'mgr_name', b.mgr_name,
   'adj_at', b.adj_at, 'adj_name', b.adj_name, 'started_at', c.started_at, 'so_status', c.status)
 into hdr
 from public.tsi_so_stores st join public.tsi_so_cycles c on c.id = b.cycle_id
 where st.code = b.store_code;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.abs_diff desc), '[]'::jsonb) into ln from (
  select s.sku, s.item_name, s.system_at_start as system_qty,
         coalesce(s.validated_qty, public.tsi_so_actual(s)) as actual_qty,
         (coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) as diff_qty,
         abs(coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) as abs_diff,
         s.unit_cost
  from public.tsi_so_lines s
  where s.cycle_id = b.cycle_id
    and coalesce(s.validated_qty, public.tsi_so_actual(s)) <> s.system_at_start
  order by abs(coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) desc
  limit 300
 ) l;
 return jsonb_build_object('header', hdr, 'summary', b.summary, 'lines', ln);
end;$$;

revoke all on function public.tsi_so_ba_name(uuid) from public, anon;
revoke all on function public.tsi_so_ba_create(uuid) from public, anon;
revoke all on function public.tsi_so_ba_sign(uuid,text) from public, anon;
revoke all on function public.tsi_so_ba_adjust(uuid,boolean) from public, anon;
revoke all on function public.tsi_so_ba_list(text,text,int) from public, anon;
revoke all on function public.tsi_so_ba_get(uuid) from public, anon;
grant execute on function public.tsi_so_ba_name(uuid) to authenticated;
grant execute on function public.tsi_so_ba_create(uuid) to authenticated;
grant execute on function public.tsi_so_ba_sign(uuid,text) to authenticated;
grant execute on function public.tsi_so_ba_adjust(uuid,boolean) to authenticated;
grant execute on function public.tsi_so_ba_list(text,text,int) to authenticated;
grant execute on function public.tsi_so_ba_get(uuid) to authenticated;
