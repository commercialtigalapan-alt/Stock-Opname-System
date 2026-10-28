-- 202610280017: Approve (tanda tangan) banyak BA sekaligus untuk SPV dan Manager. Jalankan SETELAH 202610280016. Aman diulang.
-- BA yang tidak memenuhi syarat dilewati, tidak menggagalkan batch.

create or replace function public.tsi_so_ba_sign_bulk(p_bas uuid[], p_level text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; sid uuid; ok int := 0; skip int := 0; r text; nm text; me uuid := auth.uid();
begin
 if p_level not in ('SPV','MGR') then raise exception 'Level tanda tangan tidak dikenal.'; end if;
 if p_level = 'MGR' then
  select u.role into r from public.tsi_so_users u where u.user_id = me and u.active;
  if r is distinct from 'admin' then raise exception 'Persetujuan Manager hanya untuk akun Manager.' using errcode = '42501'; end if;
 end if;
 nm := public.tsi_so_ba_name(me);
 foreach sid in array coalesce(p_bas, array[]::uuid[]) loop
  select * into b from public.tsi_so_ba where id = sid for update;
  if not found or b.cleaned_at is not null then skip := skip + 1; continue; end if;
  if p_level = 'SPV' then
   if b.spv_at is not null then skip := skip + 1; continue; end if;
   perform public.tsi_so_require_spv(b.store_code);
   update public.tsi_so_ba set spv_at = now(), spv_by = me, spv_name = nm where id = sid;
  else
   if b.spv_at is null or b.mgr_at is not null or b.spv_by = me then skip := skip + 1; continue; end if;
   update public.tsi_so_ba set mgr_at = now(), mgr_by = me, mgr_name = nm where id = sid;
  end if;
  insert into public.tsi_so_audit(user_id, store_code, event, meta)
  values (me, b.store_code, 'BA_SIGN', jsonb_build_object('ba_id', sid, 'ba_no', b.ba_no, 'level', p_level, 'bulk', true));
  ok := ok + 1;
 end loop;
 return jsonb_build_object('done', ok, 'skipped', skip);
end;$$;

revoke all on function public.tsi_so_ba_sign_bulk(uuid[], text) from public, anon;
grant execute on function public.tsi_so_ba_sign_bulk(uuid[], text) to authenticated;

-- Daftar BA: ditambah spv_by agar tombol Manager tahu BA mana yang ditandatangani oleh orang yang sama.
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
         b.spv_at, b.spv_by, b.spv_name, b.mgr_at, b.mgr_name, b.adj_at, b.adj_name, b.exported_at, b.exported_name
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

revoke all on function public.tsi_so_ba_list(text,text,int) from public, anon;
grant execute on function public.tsi_so_ba_list(text,text,int) to authenticated;
