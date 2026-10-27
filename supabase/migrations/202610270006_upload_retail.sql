-- Upload Inventory: kolom Harga Retail, preview, dan riwayat upload.
-- Jalankan SETELAH 202610270005_validation.sql. Aman dijalankan ulang.

alter table public.tsi_so_inventory add column if not exists retail_price numeric(16,2) not null default 0;
alter table public.tsi_so_inventory drop constraint if exists tsi_so_inventory_retail_price_check;
alter table public.tsi_so_inventory add constraint tsi_so_inventory_retail_price_check check (retail_price >= 0);

create or replace function public.tsi_so_upload(p_store text,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; v_count integer; v_bad integer; v_id uuid;
begin
 r:=public.tsi_so_authorize(p_store,false);
 if r not in ('store','admin') then raise exception 'Hanya toko / admin yang boleh upload.'; end if;
 if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'Data inventory harus array.'; end if;
 v_count:=jsonb_array_length(p_rows);
 if v_count not between 1 and 10000 then raise exception 'Upload 1 sampai 10000 SKU per batch.'; end if;
 select count(*) into v_bad from jsonb_array_elements(p_rows) j
 where length(trim(coalesce(j->>'sku',''))) not between 1 and 80
    or length(trim(coalesce(j->>'name',''))) not between 1 and 250
    or coalesce(j->>'ending','') !~ '^[0-9]{1,12}$'
    or coalesce(nullif(j->>'cost',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
    or coalesce(nullif(j->>'retail',''),'0') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$';
 if v_bad > 0 then raise exception 'Ada % baris tidak valid (SKU, nama, ending, cost).',v_bad; end if;
 select count(*) into v_bad from (select upper(trim(j->>'sku')) sku from jsonb_array_elements(p_rows) j group by 1 having count(*)>1) z;
 if v_bad>0 then raise exception 'Ada SKU duplikat: %.',v_bad; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('tsi_so_store:'||p_store));
 insert into public.tsi_so_uploads(store_code,uploaded_by,sku_count) values(p_store,auth.uid(),v_count) returning id into v_id;
 delete from public.tsi_so_inventory where store_code=p_store;
 insert into public.tsi_so_inventory(store_code,sku,item_name,category,ending,cost,retail_price,upload_id)
 select p_store,upper(trim(j->>'sku')),trim(j->>'name'),left(coalesce(j->>'category',''),120),
 (j->>'ending')::bigint,coalesce(nullif(j->>'cost',''),'0')::numeric,coalesce(nullif(j->>'retail',''),'0')::numeric,v_id
 from jsonb_array_elements(p_rows) j;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),p_store,'UPLOAD',jsonb_build_object('upload_id',v_id,'skus',v_count));
 return jsonb_build_object('upload_id',v_id,'sku_count',v_count,'message','Inventory aktif diganti hanya untuk toko ini; stok awal SO berjalan tetap dikunci.');
end;$$;

revoke all on function public.tsi_so_upload(text,jsonb) from public, anon;
grant execute on function public.tsi_so_upload(text,jsonb) to authenticated;

-- Riwayat upload toko (snapshot ringkas): 10 upload terakhir
create or replace function public.tsi_so_upload_history(p_store text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv','store') then raise exception 'Akses ditolak.'; end if;
 select coalesce(jsonb_agg(t.j),'[]'::jsonb) into body from (
  select jsonb_build_object('id',u.id,'uploaded_at',u.uploaded_at,'sku_count',u.sku_count,
   'uploaded_by',(select a.email from auth.users a where a.id=u.uploaded_by)) j
  from public.tsi_so_uploads u where u.store_code=p_store
  order by u.uploaded_at desc limit 10) t;
 return body;
end;$$;

revoke all on function public.tsi_so_upload_history(text) from public, anon;
grant execute on function public.tsi_so_upload_history(text) to authenticated;
