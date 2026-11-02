-- Migration 027: koreksi SKU resmi untuk BA historis yang belum dibersihkan.
-- Prasyarat: migrasi 025 dan 026 sudah BERHASIL dijalankan.
-- Sumber SKU: public.tsi_so_item_sku_map (Item Library DC TIGALAPAN).
-- Termasuk BA sudah SPV-sign, Manager-approved, exported, dan SO archived selama
-- detail SKU MASIH tersimpan; BA cleaned/tombstone tidak bisa dipulihkan.
-- Tanggal, nomor BA, nama penandatangan, status, qty, nilai dan alasan TIDAK diubah.
-- Sebelum Run: BACKUP database, hentikan counting/upload dan buat salinan BA lama.
-- Satu transaksi: error/collision menyebabkan seluruh update rollback.
-- Untuk BA yang telah diekspor, unduh ulang HTML/PDF setelah migrasi berhasil.

begin;

do $prereq$
begin
 if to_regclass('public.tsi_so_item_sku_map') is null then
  raise exception 'Migrasi 026 belum terpasang: tabel tsi_so_item_sku_map tidak ditemukan.';
 end if;
 if to_regclass('public.tsi_so_ba') is null then
  raise exception 'Tabel BA tidak tersedia.';
 end if;
end $prereq$;

lock table public.tsi_so_ba, public.tsi_so_lines, public.tsi_so_cycles
 in share row exclusive mode;

-- Rekam SKU asli hingga SKU koreksi per baris, tetap ada selama BA masih disimpan.
create table if not exists public.tsi_so_ba_sku_revision (
 ba_id uuid not null references public.tsi_so_ba(id) on delete cascade,
 line_id uuid not null,
 cycle_id uuid not null,
 store_code text not null,
 ba_no text not null,
 item_name text not null,
 old_sku text not null,
 new_sku text not null,
 corrected_at timestamptz not null default now(),
 primary key (ba_id, line_id),
 constraint tsi_so_revision_changed check (old_sku <> new_sku)
);
create index if not exists tsi_so_ba_sku_revision_ba on public.tsi_so_ba_sku_revision(ba_id,corrected_at);
alter table public.tsi_so_ba_sku_revision enable row level security;
revoke all on table public.tsi_so_ba_sku_revision from public, anon, authenticated;

-- Perbaiki HANYA baris yang masih memakai nama item sebagai SKU.
-- Tidak menebak SKU kosong, kode non-nama yang berbeda, atau record BA yang telah cleaned.
create temp table _ba027_fixes on commit drop as
select b.id ba_id, b.ba_no, b.store_code, b.cycle_id,
       l.id line_id, l.item_name, l.sku old_sku, m.official_sku new_sku
from public.tsi_so_ba b
join public.tsi_so_lines l on l.cycle_id=b.cycle_id
join public.tsi_so_item_sku_map m on m.item_key=upper(btrim(l.item_name))
where b.cleaned_at is null
  and upper(btrim(l.sku))=m.item_key
  and l.sku<>m.official_sku;
create unique index on _ba027_fixes(line_id);
create index on _ba027_fixes(ba_id);

-- Preflight: jangan rusak UNIQUE (cycle_id, sku) atau overwrite alasan yang sudah ada.
do $guard$
declare bad record;
begin
 select x.cycle_id, x.final_sku, x.qty into bad from (
  select l.cycle_id, coalesce(f.new_sku,l.sku) final_sku, count(*) qty
  from public.tsi_so_lines l
  join public.tsi_so_ba b on b.cycle_id=l.cycle_id and b.cleaned_at is null
  left join _ba027_fixes f on f.line_id=l.id
  group by l.cycle_id, coalesce(f.new_sku,l.sku)
  having count(*)>1
  limit 1
 ) x;
 if found then
  raise exception 'KONFLIK SKU pada SO %: SKU % dipakai % baris. Semua perubahan dibatalkan.',
   bad.cycle_id,bad.final_sku,bad.qty;
 end if;
 if exists (
  select 1 from _ba027_fixes f
  join public.tsi_so_ba b on b.id=f.ba_id
  where b.reason_overrides ? f.old_sku and b.reason_overrides ? f.new_sku
 ) then
  raise exception 'KONFLIK Alasan BA: terdapat alasan pada SKU lama DAN baru. Semua perubahan dibatalkan.';
 end if;
 if exists (
  select 1 from public.tsi_so_lines l join _ba027_fixes f
   on l.cycle_id=f.cycle_id and l.sku='__BA027_'||md5(f.line_id::text)
 ) then
  raise exception 'Kode sementara migrasi 027 berbenturan dengan data asli. Semua perubahan dibatalkan.';
 end if;
end $guard$;

-- Jejak audit permanen: satu row per SKU, plus audit event per nomor BA.
insert into public.tsi_so_ba_sku_revision
 (ba_id,line_id,cycle_id,store_code,ba_no,item_name,old_sku,new_sku)
select ba_id,line_id,cycle_id,store_code,ba_no,item_name,old_sku,new_sku
from _ba027_fixes
on conflict (ba_id,line_id) do nothing;

insert into public.tsi_so_audit(user_id,store_code,event,meta)
select null, f.store_code, 'BA_SKU_OFFICIAL_CORRECTION',
 jsonb_build_object(
  'ba_id',f.ba_id, 'ba_no',f.ba_no, 'cycle_id',f.cycle_id,
  'count',count(*),'sku_corrections',
    jsonb_agg(jsonb_build_object('item_name',f.item_name,'before',f.old_sku,'after',f.new_sku)
      order by f.item_name),
  'signed_spv', b.spv_at is not null,
  'approved_manager', b.mgr_at is not null,
  'previously_exported', b.exported_at is not null,
  'note','Koreksi kode SKU administratif; qty/nilai, alasan dan approval tidak diubah.'
 )
from _ba027_fixes f
join public.tsi_so_ba b on b.id=f.ba_id
group by f.ba_id,f.ba_no,f.cycle_id,f.store_code,b.spv_at,b.mgr_at,b.exported_at;

-- Pertahankan nilai alasan; ubah hanya key JSON SKU lama ke resmi.
update public.tsi_so_ba b
set reason_overrides = (
 select coalesce(jsonb_object_agg(coalesce(f.new_sku,e.key),e.value),'{}'::jsonb)
 from jsonb_each(coalesce(b.reason_overrides,'{}'::jsonb)) e
 left join _ba027_fixes f on f.ba_id=b.id and f.old_sku=e.key
)
where exists (select 1 from _ba027_fixes f where f.ba_id=b.id)
  and b.reason_overrides is not null and b.reason_overrides<>'{}'::jsonb;

-- Dua tahap menghindari collision transient saat SKU dipertukarkan.
update public.tsi_so_lines l
set sku='__BA027_'||md5(f.line_id::text)
from _ba027_fixes f where l.id=f.line_id;
update public.tsi_so_lines l set sku=f.new_sku
from _ba027_fixes f
where l.id=f.line_id and l.sku='__BA027_'||md5(f.line_id::text);

-- Selaraskan daftar scope dan aturan SKU pada SO historis yang ikut terkoreksi.
create or replace function public.tsi_so_027_rewrite_skus(p_list jsonb)
returns jsonb language sql stable security definer set search_path = '' as $fn$
 select case when p_list is null or jsonb_typeof(p_list)<>'array' then p_list
 else (select coalesce(jsonb_agg(to_jsonb(coalesce(m.official_sku,e.s)) order by e.ord),'[]'::jsonb)
 from jsonb_array_elements_text(p_list) with ordinality as e(s,ord)
 left join public.tsi_so_item_sku_map m on m.item_key=upper(btrim(e.s))) end
$fn$;
revoke all on function public.tsi_so_027_rewrite_skus(jsonb) from public,anon,authenticated;

update public.tsi_so_cycles c
set scope_skus=public.tsi_so_027_rewrite_skus(c.scope_skus),
 scope_rule=case when jsonb_typeof(c.scope_rule)='object' then
   jsonb_set(c.scope_rule,'{skus}',public.tsi_so_027_rewrite_skus(coalesce(c.scope_rule->'skus','[]'::jsonb)),true)
   else c.scope_rule end,
 team_map=case when jsonb_typeof(c.team_map)='array' then
  (select coalesce(jsonb_agg(case when jsonb_typeof(t.v->'rule')='object' then
   jsonb_set(t.v,'{rule,skus}',public.tsi_so_027_rewrite_skus(coalesce(t.v->'rule'->'skus','[]'::jsonb)),true)
   else t.v end order by t.ord),'[]'::jsonb)
   from jsonb_array_elements(c.team_map) with ordinality t(v,ord))
   else c.team_map end
where exists(select 1 from _ba027_fixes f where f.cycle_id=c.id)
  and (c.scope_skus is not null or c.scope_rule is not null or c.team_map is not null);

drop function public.tsi_so_027_rewrite_skus(jsonb);

-- Backend BA get & export di-replace di bawah agar header mengandung informasi revisi.

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
   'exported_at', b.exported_at,
   'sku_correction_count', (select count(*) from public.tsi_so_ba_sku_revision r where r.ba_id=b.id),
   'sku_correction_at', (select max(r.corrected_at) from public.tsi_so_ba_sku_revision r where r.ba_id=b.id))
 into hdr
 from public.tsi_so_stores st join public.tsi_so_cycles c on c.id = b.cycle_id
 where st.code = b.store_code;
 select coalesce(jsonb_agg(to_jsonb(l) order by l.abs_diff desc), '[]'::jsonb) into ln from (
  select s.sku, s.item_name, s.system_at_start as system_qty,
         coalesce(s.validated_qty, public.tsi_so_actual(s)) as actual_qty,
         (coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) as diff_qty,
         abs(coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) as abs_diff,
         s.unit_cost,
         coalesce(nullif(b.reason_overrides ->> s.sku,''),
          nullif(btrim(s.spv_note),''), nullif(btrim(s.store_note),''), '') as reason
  from public.tsi_so_lines s
  where s.cycle_id = b.cycle_id
    and coalesce(s.validated_qty, public.tsi_so_actual(s)) <> s.system_at_start
  order by abs(coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) desc
  limit 300
 ) l;
 return jsonb_build_object('header', hdr, 'summary', b.summary, 'lines', ln);
end;$$;

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
    'adj_at', b.adj_at, 'adj_name', b.adj_name, 'started_at', c.started_at, 'so_status', c.status,
    'sku_correction_count', (select count(*) from public.tsi_so_ba_sku_revision r where r.ba_id=b.id),
    'sku_correction_at', (select max(r.corrected_at) from public.tsi_so_ba_sku_revision r where r.ba_id=b.id))
  into hdr
  from public.tsi_so_stores st join public.tsi_so_cycles c on c.id = b.cycle_id
  where st.code = b.store_code;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.abs_diff desc), '[]'::jsonb) into ln from (
   select s.sku, s.item_name, s.system_at_start as system_qty,
          coalesce(s.validated_qty, public.tsi_so_actual(s)) as actual_qty,
          (coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) as diff_qty,
          abs(coalesce(s.validated_qty, public.tsi_so_actual(s)) - s.system_at_start) as abs_diff,
          s.unit_cost,
          coalesce(nullif(b.reason_overrides ->> s.sku,''),
           nullif(btrim(s.spv_note),''), nullif(btrim(s.store_note),''), '') as reason
   from public.tsi_so_lines s
   where s.cycle_id = b.cycle_id
     and coalesce(s.validated_qty, public.tsi_so_actual(s)) <> s.system_at_start
  ) l;
  out := out || jsonb_build_array(jsonb_build_object('header', hdr, 'summary', b.summary, 'lines', ln));
 end loop;
 return out;
end;$$;

-- Pertahankan hanya akses RPC sebelumnya untuk authenticated.
revoke all on function public.tsi_so_ba_get(uuid) from public,anon;
revoke all on function public.tsi_so_ba_export(uuid[]) from public,anon;
grant execute on function public.tsi_so_ba_get(uuid) to authenticated;
grant execute on function public.tsi_so_ba_export(uuid[]) to authenticated;

-- Hasil migrasi; gunakan tab Results di SQL Editor untuk memeriksa jumlah BA & SKU.
select (select count(distinct ba_id) from _ba027_fixes) as ba_updated,
       (select count(*) from _ba027_fixes) as sku_updated,
       (select count(*) from public.tsi_so_ba_sku_revision) as total_sku_revision_records,
       (select count(*) from public.tsi_so_ba b where b.cleaned_at is not null) as ba_cleaned_not_recoverable;
commit;
