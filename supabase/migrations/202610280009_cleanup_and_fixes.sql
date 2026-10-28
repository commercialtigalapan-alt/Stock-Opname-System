-- 202610280009: (1) Store boleh membaca kategori & inventory toko sendiri,
-- (2) hapus SO mengembalikan rasio SKU yang sudah dicatat saat submit,
-- (3) Pembersihan sampah database oleh Admin (rasio nol, audit lama, upload tak terpakai).
-- Jalankan SETELAH 202610280008_store_schedule.sql. Aman dijalankan ulang.

-- dari 202610280001_app_parity.sql
create or replace function public.tsi_so_categories(p_store text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('category',t.category,'count',t.n) order by t.category),'[]'::jsonb) into body
 from (select i.category, count(*) n from public.tsi_so_inventory i where i.store_code=p_store group by i.category) t;
 return body;
end;$$;

-- dari 202610270004_schedule.sql
create or replace function public.tsi_so_inventory_list(p_store text, p_offset integer default 0, p_limit integer default 100, p_search text default '')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb; q text;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 q:=coalesce(trim(p_search),'');
 select jsonb_build_object(
  'total',(select count(*) from public.tsi_so_inventory i where i.store_code=p_store
     and (q='' or i.sku ilike '%'||upper(q)||'%' or i.item_name ilike '%'||q||'%')),
  'items',(select coalesce(jsonb_agg(t.j),'[]'::jsonb) from (
     select jsonb_build_object('sku',i.sku,'name',i.item_name,'category',i.category,'ending',i.ending) j
     from public.tsi_so_inventory i where i.store_code=p_store
       and (q='' or i.sku ilike '%'||upper(q)||'%' or i.item_name ilike '%'||q||'%')
     order by i.ending desc, i.sku
     limit least(greatest(p_limit,1),100) offset greatest(p_offset,0)) t))
 into body;
 return body;
end;$$;

-- dari 202610280008_store_schedule.sql
create or replace function public.tsi_so_schedule_delete(p_cycles uuid[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; c public.tsi_so_cycles%rowtype; v_id uuid; k int:=0;
begin
 if p_cycles is null or array_length(p_cycles,1) is null then raise exception 'Pilih SO yang akan dihapus.'; end if;
 foreach v_id in array p_cycles loop
  select * into c from public.tsi_so_cycles where id=v_id for update;
  if not found then continue; end if;
  r:=public.tsi_so_authorize(c.store_code,true);
  if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
  if c.archived_at is not null or c.status='APPROVED' then raise exception 'SO yang sudah APPROVED tidak bisa dihapus. Gunakan arsip.'; end if;
  if r='store' and c.status<>'SCHEDULED' then raise exception 'Store hanya bisa menghapus jadwal yang belum diproses.'; end if;
  if c.status='SUBMITTED' and r<>'admin' then raise exception 'SO berstatus Validasi SPV hanya bisa dihapus Admin.'; end if;
  if c.rounds_recorded then
   update public.tsi_so_sku_rounds r set so_count=r.so_count-1 from public.tsi_so_lines l
    where l.cycle_id=v_id and r.store_code=c.store_code and r.sku=l.sku;
   delete from public.tsi_so_sku_rounds where store_code=c.store_code and so_count<=0;
  end if;
  delete from public.tsi_so_lines where cycle_id=v_id;
  delete from public.tsi_so_cycles where id=v_id;
  insert into public.tsi_so_audit(user_id,store_code,event,meta)
  values(auth.uid(),c.store_code,'DELETE',jsonb_build_object('cycle_id',v_id,'status',c.status,'so_type',c.so_type));
  k:=k+1;
 end loop;
 return jsonb_build_object('deleted',k);
end;$$;

-- (3) Pembersihan sampah (Admin). Tidak menghapus SO, detail SO, atau inventory aktif.
create or replace function public.tsi_so_cleanup_scan(p_audit_days integer default 365, p_upload_days integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 return jsonb_build_object(
  'zero_rounds',(select count(*) from public.tsi_so_sku_rounds where so_count<=0),
  'old_audit',(select count(*) from public.tsi_so_audit where occurred_at < now()-make_interval(days=>greatest(p_audit_days,1))),
  'stale_uploads',(select count(*) from public.tsi_so_uploads u where u.uploaded_at < now()-make_interval(days=>greatest(p_upload_days,1))
     and not exists(select 1 from public.tsi_so_inventory i where i.upload_id=u.id)
     and not exists(select 1 from public.tsi_so_cycles c where c.upload_id=u.id)));
end;$$;

create or replace function public.tsi_so_cleanup_run(p_audit_days integer default 365, p_upload_days integer default 30)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; a int; b int; c int; d int;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 delete from public.tsi_so_sku_rounds where so_count<=0; get diagnostics a = row_count;
 delete from public.tsi_so_audit where occurred_at < now()-make_interval(days=>greatest(p_audit_days,1)); get diagnostics b = row_count;
 delete from public.tsi_so_uploads u where u.uploaded_at < now()-make_interval(days=>greatest(p_upload_days,1))
   and not exists(select 1 from public.tsi_so_inventory i where i.upload_id=u.id)
   and not exists(select 1 from public.tsi_so_cycles c where c.upload_id=u.id);
 get diagnostics c = row_count;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
  values(auth.uid(),null,'CLEANUP',jsonb_build_object('zero_rounds',a,'old_audit',b,'stale_uploads',c));
 return jsonb_build_object('zero_rounds',a,'old_audit',b,'stale_uploads',c);
end;$$;

revoke all on function public.tsi_so_cleanup_scan(integer,integer) from public, anon;
grant execute on function public.tsi_so_cleanup_scan(integer,integer) to authenticated;
revoke all on function public.tsi_so_cleanup_run(integer,integer) from public, anon;
grant execute on function public.tsi_so_cleanup_run(integer,integer) to authenticated;

