-- Jalankan pada project tujuan yang sudah memiliki sql/01_database.sql.
-- Tidak mengubah isi native_sheet, native_state, atau data yang sudah diimpor.
begin;
create table if not exists public.native_import_job (
 id uuid primary key default gen_random_uuid(), import_key text not null unique,
 manifest jsonb not null, properties jsonb not null, files jsonb not null, triggers jsonb not null,
 base_revision bigint not null, status text not null default 'uploading', revision bigint,
 created_at timestamptz not null default now()
);
create table if not exists public.native_import_chunk (
 job_id uuid not null references public.native_import_job(id), name text not null,
 chunk_index integer not null, payload jsonb not null, hash text not null,
 primary key(job_id,name,chunk_index)
);
create table if not exists public.native_import_sheet (
 job_id uuid not null references public.native_import_job(id), name text not null,
 payload jsonb not null, primary key(job_id,name)
);
alter table public.native_import_job enable row level security;
alter table public.native_import_chunk enable row level security;
alter table public.native_import_sheet enable row level security;
revoke all on public.native_import_job,public.native_import_chunk,public.native_import_sheet from public,anon,authenticated;

create or replace function public.native_import_begin(p_key text,p_manifest jsonb,p_properties jsonb,p_files jsonb,p_triggers jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
declare j native_import_job%rowtype; r bigint; ready jsonb; received jsonb;
begin
 select revision into r from native_state where id=true for update;
 if r is null then raise exception 'native_state belum tersedia'; end if;
 select * into j from native_import_job where import_key=p_key for update;
 if found and j.manifest<>p_manifest then raise exception 'Manifest tidak cocok'; end if;
 if j.status='completed' then return jsonb_build_object('id',j.id,'status',j.status,'revision',j.revision); end if;
 if exists(select 1 from native_sheet) then raise exception 'Database sudah berisi tab. Periksa hasil impor sebelumnya; jangan hapus data'; end if;
 if j.id is null then
   if jsonb_typeof(p_manifest)<>'object' or p_manifest='{}'::jsonb then raise exception 'Manifest kosong/tidak valid'; end if;
   if exists(select 1 from native_import_job where status<>'completed') then raise exception 'Ada impor lain yang belum selesai. Gunakan data dan APP_AUTH_SECRET yang sama'; end if;
   insert into native_import_job(import_key,manifest,properties,files,triggers,base_revision)
   values(p_key,p_manifest,p_properties,p_files,p_triggers,r) returning * into j;
 end if;
 if j.base_revision<>r then raise exception 'Revision berubah; impor tidak dapat dilanjutkan'; end if;
 select coalesce(jsonb_agg(name),'[]'::jsonb) into ready from native_import_sheet where job_id=j.id;
 select coalesce(jsonb_object_agg(name,indices),'{}'::jsonb) into received from
 (select name,jsonb_agg(chunk_index order by chunk_index) indices from native_import_chunk where job_id=j.id group by name) x;
 return jsonb_build_object('id',j.id,'status',j.status,'ready',ready,'received',received);
end; $$;

create or replace function public.native_import_chunk(p_job uuid,p_name text,p_index integer,p_text text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
declare j native_import_job%rowtype; expected jsonb; data jsonb; h text;
begin
 select * into j from native_import_job where id=p_job for update;
 if not found or j.status<>'uploading' then raise exception 'Impor tidak aktif'; end if;
 expected=j.manifest->p_name->'chunks'->p_index;
 if p_index<0 or expected is null then raise exception 'Bagian tidak dikenal'; end if;
 h=md5(p_text); if h<>(expected->>'hash') then raise exception 'Checksum bagian tidak cocok'; end if;
 data=p_text::jsonb;
 if jsonb_typeof(data)<>'array' then raise exception 'Bagian harus berupa array'; end if;
 if jsonb_array_length(data)<>(expected->>'rows')::integer then raise exception 'Jumlah baris bagian tidak cocok'; end if;
 insert into native_import_chunk(job_id,name,chunk_index,payload,hash) values(p_job,p_name,p_index,data,h)
 on conflict(job_id,name,chunk_index) do nothing;
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.native_import_sheet(p_job uuid,p_name text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
declare j native_import_job%rowtype; m jsonb; n integer; rows jsonb;
begin
 select * into j from native_import_job where id=p_job for update;
 if not found or j.status<>'uploading' then raise exception 'Impor tidak aktif'; end if;
 m=j.manifest->p_name; if m is null then raise exception 'Tab tidak dikenal'; end if;
 if exists(select 1 from native_import_sheet where job_id=p_job and name=p_name) then return jsonb_build_object('ok',true); end if;
 select count(*) into n from native_import_chunk where job_id=p_job and name=p_name;
 if n<>jsonb_array_length(m->'chunks') then raise exception 'Bagian tab belum lengkap'; end if;
 select coalesce(jsonb_agg(v.value order by c.chunk_index,v.ord),'[]'::jsonb) into rows
 from native_import_chunk c cross join lateral jsonb_array_elements(c.payload) with ordinality v(value,ord)
 where c.job_id=p_job and c.name=p_name;
 if jsonb_array_length(rows)<>(m->>'rows')::integer then raise exception 'Jumlah baris tab tidak cocok'; end if;
 insert into native_import_sheet(job_id,name,payload) values(p_job,p_name,
 jsonb_build_object('rows',rows,'maxRows',(m->>'maxRows')::integer,'maxCols',(m->>'maxCols')::integer));
 return jsonb_build_object('ok',true);
end; $$;

create or replace function public.native_import_finish(p_job uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
declare j native_import_job%rowtype; r bigint; n integer; expected integer;
begin
 select revision into r from native_state where id=true for update;
 select * into j from native_import_job where id=p_job for update;
 if not found then raise exception 'Impor tidak dikenal'; end if;
 if j.status='completed' then return jsonb_build_object('revision',j.revision,'duplicate',true); end if;
 if r<>j.base_revision or exists(select 1 from native_sheet) then raise exception 'Database berubah; impor dibatalkan tanpa menimpa data'; end if;
 select count(*) into expected from jsonb_object_keys(j.manifest);
 select count(*) into n from native_import_sheet where job_id=p_job;
 if n<>expected then raise exception 'Tab belum lengkap'; end if;
 insert into native_sheet(name,payload) select name,payload from native_import_sheet where job_id=p_job;
 update native_state set revision=r+1,properties=j.properties,files=j.files,triggers=j.triggers where id=true;
 insert into native_commit_log(request_id,revision) values(j.id,r+1);
 update native_import_job set status='completed',revision=r+1 where id=p_job;
 -- Semua langkah, termasuk pembersihan staging, berada dalam transaksi yang sama.
 delete from native_import_chunk where job_id=p_job;
 delete from native_import_sheet where job_id=p_job;
 return jsonb_build_object('revision',r+1,'tables',n);
end; $$;

revoke all on function public.native_import_begin(text,jsonb,jsonb,jsonb,jsonb) from public,anon,authenticated;
revoke all on function public.native_import_chunk(uuid,text,integer,text) from public,anon,authenticated;
revoke all on function public.native_import_sheet(uuid,text) from public,anon,authenticated;
revoke all on function public.native_import_finish(uuid) from public,anon,authenticated;
grant execute on function public.native_import_begin(text,jsonb,jsonb,jsonb,jsonb) to service_role;
grant execute on function public.native_import_chunk(uuid,text,integer,text) to service_role;
grant execute on function public.native_import_sheet(uuid,text) to service_role;
grant execute on function public.native_import_finish(uuid) to service_role;
commit;
