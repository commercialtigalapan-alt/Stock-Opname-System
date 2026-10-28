-- 202610280014: Export lengkap lalu bersihkan Berita Acara (BA), mengikuti alur SO.
-- Jalankan SETELAH 202610280013_berita_acara.sql. Aman dijalankan ulang.
-- BA yang dibersihkan hanya menyisakan nomor BA sebagai penanda (tombstone) agar tidak dibuat ulang.

alter table public.tsi_so_ba add column if not exists exported_at timestamptz;
alter table public.tsi_so_ba add column if not exists exported_name text;
alter table public.tsi_so_ba add column if not exists cleaned_at timestamptz;

-- Dokumen lengkap (semua SKU selisih, tanpa batas) untuk diunduh dan disimpan ke Drive.
create or replace function public.tsi_so_ba_export(p_bas uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; out jsonb := '[]'::jsonb; hdr jsonb; ln jsonb; sid uuid;
begin
 foreach sid in array coalesce(p_bas, array[]::uuid[]) loop
  select * into b from public.tsi_so_ba where id = sid;
  if not found then raise exception 'BA tidak ditemukan.'; end if;
  if b.cleaned_at is not null then raise exception 'BA % sudah dibersihkan dari database.', b.ba_no; end if;
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
  ) l;
  out := out || jsonb_build_array(jsonb_build_object('header', hdr, 'summary', b.summary, 'lines', ln));
 end loop;
 return out;
end;$$;

-- Tandai BA sudah diekspor (dipanggil setelah file berhasil diunduh).
create or replace function public.tsi_so_ba_mark_exported(p_bas uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; sid uuid; cnt int := 0;
begin
 foreach sid in array coalesce(p_bas, array[]::uuid[]) loop
  select * into b from public.tsi_so_ba where id = sid;
  if not found or b.cleaned_at is not null then continue; end if;
  perform public.tsi_so_require_spv(b.store_code);
  update public.tsi_so_ba set exported_at = now(), exported_name = public.tsi_so_ba_name(auth.uid()) where id = sid;
  cnt := cnt + 1;
 end loop;
 return cnt;
end;$$;

-- Bersihkan BA dari database. Wajib sudah diekspor. Hanya penanda nomor BA yang tersisa.
create or replace function public.tsi_so_ba_clean(p_bas uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; sid uuid; cnt int := 0;
begin
 foreach sid in array coalesce(p_bas, array[]::uuid[]) loop
  select * into b from public.tsi_so_ba where id = sid for update;
  if not found or b.cleaned_at is not null then continue; end if;
  perform public.tsi_so_require_spv(b.store_code);
  if b.exported_at is null then raise exception 'BA % belum diekspor. Unduh dan simpan ke Drive dulu.', b.ba_no; end if;
  update public.tsi_so_ba set cleaned_at = now(), summary = '{}'::jsonb,
    spv_at = null, spv_by = null, spv_name = null, mgr_at = null, mgr_by = null, mgr_name = null,
    adj_at = null, adj_by = null, adj_name = null, created_name = ''
  where id = sid;
  insert into public.tsi_so_audit(user_id, store_code, event, meta)
  values (auth.uid(), b.store_code, 'BA_CLEAN', jsonb_build_object('ba_id', sid, 'ba_no', b.ba_no));
  cnt := cnt + 1;
 end loop;
 return cnt;
end;$$;

-- Daftar BA aktif (yang belum dibersihkan).
create or replace function public.tsi_so_ba_list(p_store text default null, p_status text default 'ALL', p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.tsi_so_users%rowtype; r jsonb;
begin
 select * into me from public.tsi_so_users where user_id = auth.uid() and active;
 if not found or me.role = 'store' then raise exception 'Tidak memiliki akses BA.' using errcode = '42501'; end if;
 if p_store is not null then perform public.tsi_so_require_spv(p_store); end if;
 select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into r from (
  select b.id, b.ba_no, b.store_code, st.name as store_name, b.created_at, b.created_name, b.summary,
         b.spv_at, b.spv_name, b.mgr_at, b.mgr_name, b.adj_at, b.adj_name, b.exported_at, b.exported_name
  from public.tsi_so_ba b join public.tsi_so_stores st on st.code = b.store_code
  where b.cleaned_at is null
    and (p_store is null or b.store_code = p_store)
    and (me.role = 'admin' or exists(select 1 from public.tsi_so_spv_stores a where a.user_id = me.user_id and a.store_code = b.store_code))
    and (coalesce(p_status,'ALL') = 'ALL'
      or (p_status = 'WAIT_SPV' and b.spv_at is null)
      or (p_status = 'WAIT_MGR' and b.spv_at is not null and b.mgr_at is null)
      or (p_status = 'WAIT_ADJ' and b.mgr_at is not null and b.adj_at is null)
      or (p_status = 'ADJUSTED' and b.adj_at is not null)
      or (p_status = 'NOT_EXPORTED' and b.exported_at is null))
  order by b.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500)
 ) x;
 return r;
end;$$;

-- Tanda tangan dan adjust tidak boleh untuk BA yang sudah dibersihkan.
create or replace function public.tsi_so_ba_sign(p_ba uuid, p_level text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; r text;
begin
 select * into b from public.tsi_so_ba where id = p_ba for update;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 if b.cleaned_at is not null then raise exception 'BA sudah dibersihkan dari database.'; end if;
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

create or replace function public.tsi_so_ba_adjust(p_ba uuid, p_done boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype;
begin
 select * into b from public.tsi_so_ba where id = p_ba for update;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 if b.cleaned_at is not null then raise exception 'BA sudah dibersihkan dari database.'; end if;
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

-- Detail BA (ditampilkan di layar, maks 300 baris selisih). Untuk unduhan lengkap pakai tsi_so_ba_export.
create or replace function public.tsi_so_ba_get(p_ba uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; hdr jsonb; ln jsonb;
begin
 select * into b from public.tsi_so_ba where id = p_ba;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 if b.cleaned_at is not null then raise exception 'BA sudah dibersihkan dari database. Lihat file yang sudah disimpan di Drive.'; end if;
 perform public.tsi_so_require_spv(b.store_code);
 select jsonb_build_object('id', b.id, 'ba_no', b.ba_no, 'store_code', b.store_code,
   'store_name', st.name, 'created_at', b.created_at, 'created_name', b.created_name,
   'spv_at', b.spv_at, 'spv_name', b.spv_name, 'mgr_at', b.mgr_at, 'mgr_name', b.mgr_name,
   'adj_at', b.adj_at, 'adj_name', b.adj_name, 'started_at', c.started_at, 'so_status', c.status,
   'exported_at', b.exported_at)
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

-- Arsip SO: sekarang juga menolak jika BA SO belum dibersihkan (dasar: 202610280011).
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
 if c.exported_at is null then raise exception 'Export CSV dulu (simpan ke Drive) sebelum dibersihkan.'; end if;
 if exists(select 1 from public.tsi_so_ba where cycle_id = p_cycle and cleaned_at is null) then raise exception 'SO ini masih punya BA. Export dan bersihkan BA dulu (simpan ke Drive).'; end if;
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

-- Buat BA: tolak jika BA SO sudah dibersihkan (dasar: 202610280013).
create or replace function public.tsi_so_ba_create(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; b public.tsi_so_ba%rowtype; s jsonb; seq bigint; rn text; yr int; bano text;
begin
 select * into c from public.tsi_so_cycles where id = p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 select * into b from public.tsi_so_ba where cycle_id = p_cycle;
 if found then
  if b.cleaned_at is not null then raise exception 'SO ini sudah punya BA (%) yang sudah dibersihkan. BA tidak bisa dibuat ulang.', b.ba_no; end if;
  return jsonb_build_object('id', b.id, 'ba_no', b.ba_no, 'existed', true);
 end if;
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

revoke all on function public.tsi_so_ba_export(uuid[]) from public, anon;
revoke all on function public.tsi_so_ba_mark_exported(uuid[]) from public, anon;
revoke all on function public.tsi_so_ba_clean(uuid[]) from public, anon;
grant execute on function public.tsi_so_ba_export(uuid[]) to authenticated;
grant execute on function public.tsi_so_ba_mark_exported(uuid[]) to authenticated;
grant execute on function public.tsi_so_ba_clean(uuid[]) to authenticated;
