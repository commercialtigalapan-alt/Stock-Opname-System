-- Perbaikan pesan submit: Qty 0 adalah nilai sah, pesan lama menyesatkan.
-- Jalankan SETELAH 202610270007_audit.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_submit(p_cycle uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; r text; pending integer;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,false);
 if r not in ('store','admin') or c.status not in ('COUNTING','RECOUNT') then raise exception 'SO tidak dapat disubmit.'; end if;
 select count(*) into pending from public.tsi_so_lines where cycle_id=p_cycle and (warehouse_qty is null or display_qty is null);
 if pending>0 then raise exception 'Masih ada % SKU yang belum diisi Gudang atau Display. Isi 0 jika kosong.',pending; end if;
 update public.tsi_so_cycles set status='SUBMITTED',submitted_at=now() where id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'SUBMIT',jsonb_build_object('cycle_id',p_cycle));
 return 'SUBMITTED';
end;$$;

revoke all on function public.tsi_so_submit(uuid) from public, anon;
grant execute on function public.tsi_so_submit(uuid) to authenticated;
