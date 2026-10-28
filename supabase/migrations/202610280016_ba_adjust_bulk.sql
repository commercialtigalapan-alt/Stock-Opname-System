-- 202610280016: Tandai adjust banyak BA sekaligus (dan batalkan). Jalankan SETELAH 202610280015. Aman diulang.
-- BA yang belum disetujui Manager atau sudah dibersihkan dilewati (tidak menggagalkan batch).

create or replace function public.tsi_so_ba_adjust_bulk(p_bas uuid[], p_done boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.tsi_so_ba%rowtype; sid uuid; ok int := 0; skip int := 0; nm text;
begin
 nm := public.tsi_so_ba_name(auth.uid());
 foreach sid in array coalesce(p_bas, array[]::uuid[]) loop
  select * into b from public.tsi_so_ba where id = sid for update;
  if not found or b.cleaned_at is not null or b.mgr_at is null then skip := skip + 1; continue; end if;
  perform public.tsi_so_require_spv(b.store_code);
  if coalesce(p_done, false) then
   update public.tsi_so_ba set adj_at = coalesce(adj_at, now()), adj_by = coalesce(adj_by, auth.uid()), adj_name = coalesce(adj_name, nm) where id = sid;
  else
   update public.tsi_so_ba set adj_at = null, adj_by = null, adj_name = null where id = sid;
  end if;
  insert into public.tsi_so_audit(user_id, store_code, event, meta)
  values (auth.uid(), b.store_code, 'BA_ADJUST', jsonb_build_object('ba_id', sid, 'ba_no', b.ba_no, 'done', coalesce(p_done, false), 'bulk', true));
  ok := ok + 1;
 end loop;
 return jsonb_build_object('done', ok, 'skipped', skip);
end;$$;

revoke all on function public.tsi_so_ba_adjust_bulk(uuid[], boolean) from public, anon;
grant execute on function public.tsi_so_ba_adjust_bulk(uuid[], boolean) to authenticated;
