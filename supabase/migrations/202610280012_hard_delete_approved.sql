-- 202610280012: Admin dapat menghapus permanen SO yang salah APPROVED (tanpa export).
-- Detail SKU dan SO dihapus dari database, rasio SKU dikembalikan, dan tidak lagi dihitung di dashboard.
-- Jalankan SETELAH 202610280011_export_before_clean.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_hard_delete(p_cycles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; cid uuid; c public.tsi_so_cycles%rowtype; k int:=0; warn int:=0;
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
   warn:=warn+1; -- detail sudah dibersihkan, rasio tidak bisa dikembalikan otomatis (pakai Sinkronisasi Rasio)
  end if;
  delete from public.tsi_so_lines where cycle_id=cid;
  delete from public.tsi_so_cycles where id=cid;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
   values(auth.uid(),c.store_code,'HARD_DELETE',jsonb_build_object('cycle_id',cid,'status',c.status,'so_type',c.so_type,'archived',c.archived_at is not null));
  k:=k+1;
 end loop;
 return jsonb_build_object('deleted',k,'archived_rounds_not_reverted',warn);
end;$$;

revoke all on function public.tsi_so_hard_delete(uuid[]) from public, anon;
grant execute on function public.tsi_so_hard_delete(uuid[]) to authenticated;
