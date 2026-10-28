-- 202610280015: Hapus permanen SO tanpa jejak di database.
-- Jalankan SETELAH 202610280014_ba_export_clean.sql. Aman dijalankan ulang.
-- Yang dihapus: SO, detail SKU, BA (termasuk penanda BA), dan semua baris audit yang menyebut SO/BA tersebut.
-- Catatan: rasio SKU untuk SO yang sudah diarsipkan tidak bisa dikembalikan otomatis (pakai Sinkronisasi Rasio).

create or replace function public.tsi_so_hard_delete(p_cycles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; cid uuid; c public.tsi_so_cycles%rowtype; k int:=0; warn int:=0; bid uuid;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin yang bisa menghapus permanen SO.'; end if;
 if p_cycles is null or coalesce(array_length(p_cycles,1),0)=0 then raise exception 'Pilih SO yang akan dihapus.'; end if;
 foreach cid in array p_cycles loop
  select * into c from public.tsi_so_cycles where id=cid for update;
  if not found then continue; end if;
  if c.archived_at is null and c.rounds_recorded then
   update public.tsi_so_sku_rounds r set so_count=r.so_count-1 from public.tsi_so_lines l
    where l.cycle_id=cid and r.store_code=c.store_code and r.sku=l.sku;
   delete from public.tsi_so_sku_rounds where store_code=c.store_code and so_count<=0;
  elsif c.archived_at is not null and c.rounds_recorded then
   warn:=warn+1;
  end if;
  -- jejak audit yang menyebut BA milik SO ini
  for bid in select id from public.tsi_so_ba where cycle_id=cid loop
   delete from public.tsi_so_audit where meta::text like '%'||bid::text||'%';
  end loop;
  delete from public.tsi_so_ba where cycle_id=cid;
  -- jejak audit yang menyebut SO ini (semua event)
  delete from public.tsi_so_audit where meta::text like '%'||cid::text||'%';
  delete from public.tsi_so_lines where cycle_id=cid;
  delete from public.tsi_so_cycles where id=cid;
  k:=k+1;
 end loop;
 return jsonb_build_object('deleted',k,'archived_rounds_not_reverted',warn);
end;$$;

-- Bersihkan sisa audit dari penghapusan sebelumnya: baris yang menyebut SO/BA yang sudah tidak ada.
create or replace function public.tsi_so_purge_orphan_audit()
returns integer language plpgsql security definer set search_path = '' as $$
declare who text; cnt int := 0; r record;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 for r in select a.id, a.meta from public.tsi_so_audit a where a.meta ? 'cycle_id' loop
  if not exists(select 1 from public.tsi_so_cycles c where c.id::text = r.meta->>'cycle_id') then
   delete from public.tsi_so_audit where id = r.id; cnt := cnt + 1;
  end if;
 end loop;
 for r in select a.id, a.meta from public.tsi_so_audit a where a.meta ? 'ba_id' loop
  if not exists(select 1 from public.tsi_so_ba b where b.id::text = r.meta->>'ba_id') then
   delete from public.tsi_so_audit where id = r.id; cnt := cnt + 1;
  end if;
 end loop;
 return cnt;
end;$$;

-- Sisa lama dibersihkan sekali saat migrasi dijalankan (aman diulang).
delete from public.tsi_so_audit a
 where a.meta ? 'cycle_id' and (a.meta->>'cycle_id') ~* '^[0-9a-f-]{36}$'
   and not exists(select 1 from public.tsi_so_cycles c where c.id::text = a.meta->>'cycle_id');
delete from public.tsi_so_audit a
 where a.meta ? 'ba_id' and (a.meta->>'ba_id') ~* '^[0-9a-f-]{36}$'
   and not exists(select 1 from public.tsi_so_ba b where b.id::text = a.meta->>'ba_id');

revoke all on function public.tsi_so_hard_delete(uuid[]) from public, anon;
revoke all on function public.tsi_so_purge_orphan_audit() from public, anon;
grant execute on function public.tsi_so_hard_delete(uuid[]) to authenticated;
grant execute on function public.tsi_so_purge_orphan_audit() to authenticated;
