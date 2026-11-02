-- 202610280025: Kolom Alasan per SKU pada Berita Acara (BA).
-- Jalankan setelah 202610280024_analytics_spv_list.sql.
-- Tidak mengubah data counting, validasi, qty, ataupun CSV Adjust untuk Moka.
-- Aman dijalankan ulang (idempotent).

alter table public.tsi_so_ba
 add column if not exists reason_overrides jsonb not null default '{}'::jsonb;

-- Koreksi alasan khusus BA. Alasan asli tetap berada di tsi_so_lines.
-- Edit dibatasi untuk SPV terkait / Admin dan hanya sebelum tanda tangan SPV.
create or replace function public.tsi_so_ba_reason_set(p_ba uuid, p_sku text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; note text := btrim(coalesce(p_reason,'')); previous text;
begin
 select * into b from public.tsi_so_ba where id = p_ba for update;
 if not found then raise exception 'BA tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(b.store_code);
 if b.cleaned_at is not null then raise exception 'BA sudah dibersihkan.'; end if;
 if b.spv_at is not null or b.mgr_at is not null then
  raise exception 'Alasan BA terkunci setelah tanda tangan SPV.';
 end if;
 if b.exported_at is not null then
  raise exception 'Alasan BA terkunci karena dokumen sudah diekspor. Hindari mengubah arsip yang tersimpan.';
 end if;
 if length(note) < 1 or length(note) > 500 then
  raise exception 'Alasan wajib diisi, maksimal 500 karakter.';
 end if;
 if not exists (
  select 1 from public.tsi_so_lines s
  where s.cycle_id = b.cycle_id and s.sku = p_sku
    and coalesce(s.validated_qty, public.tsi_so_actual(s)) <> s.system_at_start
 ) then
  raise exception 'SKU tidak termasuk daftar selisih BA ini.';
 end if;
 select coalesce(nullif(b.reason_overrides ->> p_sku,''),
   nullif(btrim(s.spv_note),''), nullif(btrim(s.store_note),''), '')
 into previous from public.tsi_so_lines s
 where s.cycle_id = b.cycle_id and s.sku = p_sku;
 update public.tsi_so_ba
 set reason_overrides = jsonb_set(coalesce(b.reason_overrides,'{}'::jsonb), array[p_sku], to_jsonb(note), true)
 where id = p_ba;
 insert into public.tsi_so_audit(user_id, store_code, event, meta)
 values (auth.uid(), b.store_code, 'BA_REASON_EDIT',
  jsonb_build_object('ba_id',p_ba,'ba_no',b.ba_no,'sku',p_sku,'before',previous,'after',note));
 return jsonb_build_object('ba_id',p_ba,'sku',p_sku,'reason',note);
end;$$;

revoke all on function public.tsi_so_ba_reason_set(uuid,text,text) from public, anon;
grant execute on function public.tsi_so_ba_reason_set(uuid,text,text) to authenticated;

-- Detail BA di halaman: 300 SKU selisih terbesar, dengan Alasan final.
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

-- Dokumen HTML lengkap dengan Alasan seluruh SKU selisih.
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

-- Membersihkan alasan edit bersama isi BA ketika dilakukan pembersihan.
create or replace function public.tsi_so_ba_clean(p_bas uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; sid uuid; cnt int := 0;
begin
 foreach sid in array coalesce(p_bas, array[]::uuid[]) loop
  select * into b from public.tsi_so_ba where id = sid for update;
  if not found or b.cleaned_at is not null then continue; end if;
  perform public.tsi_so_require_spv(b.store_code);
  if b.exported_at is null then raise exception 'BA % belum diekspor. Unduh dan simpan ke Drive dulu.', b.ba_no; end if;
  update public.tsi_so_ba set cleaned_at = now(), summary = '{}'::jsonb, reason_overrides = '{}'::jsonb,
    spv_at = null, spv_by = null, spv_name = null, mgr_at = null, mgr_by = null, mgr_name = null,
    adj_at = null, adj_by = null, adj_name = null, created_name = ''
  where id = sid;
  insert into public.tsi_so_audit(user_id, store_code, event, meta)
  values (auth.uid(), b.store_code, 'BA_CLEAN', jsonb_build_object('ba_id', sid, 'ba_no', b.ba_no));
  cnt := cnt + 1;
 end loop;
 return cnt;
end;$$;

