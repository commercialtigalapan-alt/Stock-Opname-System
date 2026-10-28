-- 1) Kunci system saat SO sudah SUBMITTED: upload inventory hanya memperbarui SO yang masih COUNTING/RECOUNT.
-- 2) Menu Validasi: SPV/Admin mengedit System, Display, Reject, Rak Utama, Rak Cadangan (acuan approval).
--    Kolom SPV Qty dihapus; validated_qty tidak dipakai lagi (nilai dari posisi yang dipakai).
-- Jalankan SETELAH 202610280018_user_admin.sql. Aman dijalankan ulang.

-- Upload inventory
create or replace function public.tsi_so_upload(p_store text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_count integer; v_bad integer; v_id uuid; v_synced integer; v_locked integer;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('store','admin','spv') then raise exception 'Tidak memiliki akses upload.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Data inventory harus array.'; end if;
 v_count:=jsonb_array_length(p_rows);
 if v_count not between 1 and 10000 then raise exception 'Upload 1 sampai 10000 SKU per batch.'; end if;
 select count(*) into v_bad from jsonb_array_elements(p_rows) j
 where length(trim(coalesce(j->>'sku',''))) not between 1 and 80
    or length(trim(coalesce(j->>'name',''))) not between 1 and 250
    or coalesce(j->>'ending','') !~ '^[0-9]{1,12}$'
    or coalesce(nullif(j->>'cost',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
    or coalesce(nullif(j->>'retail',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
 if v_bad > 0 then raise exception 'Ada % baris tidak valid (SKU, nama, ending, cost, retail).',v_bad; end if;
 select count(*) into v_bad from (select upper(trim(j->>'sku')) sku from jsonb_array_elements(p_rows) j group by 1 having count(*)>1) z;
 if v_bad>0 then raise exception 'Ada SKU duplikat: %.',v_bad; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 insert into public.tsi_so_uploads(store_code,uploaded_by,sku_count) values(p_store,auth.uid(),v_count) returning id into v_id;
 delete from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_inventory(store_code,sku,item_name,category,ending,cost,retail_price,upload_id)
 select p_store,upper(trim(j->>'sku')),trim(j->>'name'),left(coalesce(j->>'category',''),120),
 (j->>'ending')::bigint,coalesce(nullif(j->>'cost',''),'0')::numeric,coalesce(nullif(j->>'retail',''),'0')::numeric,v_id
 from jsonb_array_elements(p_rows) j;

 -- Hanya SO yang sedang COUNTING/RECOUNT yang ikut diperbarui. SO SUBMITTED dikunci.
 update public.tsi_so_lines l set system_at_start=coalesce((select i.ending from public.tsi_so_inventory i
   where i.store_code=p_store and i.sku=l.sku),0)
 where l.cycle_id in (select c.id from public.tsi_so_cycles c where c.store_code=p_store and c.status in ('COUNTING','RECOUNT'));
 get diagnostics v_synced = row_count;
 select count(*) into v_locked from public.tsi_so_lines l
  where l.cycle_id in (select c.id from public.tsi_so_cycles c where c.store_code=p_store and c.status='SUBMITTED');

 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'UPLOAD',jsonb_build_object('upload_id',v_id,'skus',v_count,'synced_lines',v_synced,'locked_lines',v_locked));
 return jsonb_build_object('upload_id',v_id,'sku_count',v_count,'synced_lines',v_synced,'locked_lines',v_locked,
  'message', case when v_locked>0
    then 'Inventory aktif diganti. SO yang sudah SUBMITTED dikunci (system tidak berubah); SO yang sedang berjalan ikut diperbarui.'
    else 'Inventory aktif diganti. System qty SO yang sedang berjalan ikut diperbarui.' end);
end;$$;

-- Validasi SPV/Admin: ubah System dan posisi (acuan approval). Hanya untuk SO SUBMITTED.
create or replace function public.tsi_so_validate_edit(p_cycle uuid,p_sku text,p_system bigint,
  p_display bigint,p_reject bigint,p_rak_utama bigint,p_rak_cadangan bigint,p_note text default '')
returns boolean language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; old_sys bigint;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'SUBMITTED' then raise exception 'Hanya SO SUBMITTED yang dapat divalidasi.'; end if;
 if p_system is null or p_system<0 then raise exception 'System qty harus bilangan >= 0.'; end if;
 if least(coalesce(p_display,0),coalesce(p_reject,0),coalesce(p_rak_utama,0),coalesce(p_rak_cadangan,0))<0 then
   raise exception 'Qty posisi tidak boleh negatif.'; end if;
 if length(coalesce(p_note,''))>500 then raise exception 'Catatan terlalu panjang.'; end if;

 select system_at_start into old_sys from public.tsi_so_lines where cycle_id=p_cycle and sku=upper(trim(p_sku));
 if not found then raise exception 'SKU tidak ditemukan.'; end if;

 update public.tsi_so_lines set system_at_start=p_system,
   pos_display=p_display, pos_reject=p_reject, pos_rak_utama=p_rak_utama, pos_rak_cadangan=p_rak_cadangan,
   validated_qty=null, spv_note=coalesce(p_note,''), updated_at=now(), updated_by=auth.uid()
 where cycle_id=p_cycle and sku=upper(trim(p_sku));

 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'VALIDATE_EDIT',jsonb_build_object('cycle_id',p_cycle,'sku',upper(trim(p_sku)),
   'system_old',old_sys,'system_new',p_system));
 return true;
end;$$;

-- Angka SPV Qty lama tidak dipakai lagi: sumber kebenaran adalah posisi (dan System hasil validasi).
update public.tsi_so_lines set validated_qty=null
 where validated_qty is not null
   and cycle_id in (select id from public.tsi_so_cycles where status='SUBMITTED');

revoke all on function public.tsi_so_validate_edit(uuid,text,bigint,bigint,bigint,bigint,bigint,text) from public, anon;
grant execute on function public.tsi_so_validate_edit(uuid,text,bigint,bigint,bigint,bigint,bigint,text) to authenticated;
revoke all on function public.tsi_so_validate_line(uuid,text,bigint,text) from public, anon, authenticated;
