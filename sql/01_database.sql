-- Install only in the NEW Supabase project. Never expose server secret keys.
begin;
create table if not exists public.native_state (
 id boolean primary key default true check(id), revision bigint not null default 0,
 properties jsonb not null default '{}', files jsonb not null default '{}', triggers jsonb not null default '[]'
);
insert into public.native_state(id) values(true) on conflict do nothing;
create table if not exists public.native_sheet(name text primary key, payload jsonb not null);
create table if not exists public.native_commit_log(request_id uuid primary key, revision bigint not null, created_at timestamptz not null default now());
alter table public.native_state enable row level security;
alter table public.native_sheet enable row level security;
alter table public.native_commit_log enable row level security;
revoke all on public.native_state,public.native_sheet,public.native_commit_log from anon,authenticated;
create or replace function public.native_load() returns jsonb
language sql security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
 select jsonb_build_object('revision',revision,'properties',properties,'files',files,'triggers',triggers,
 'sheets',coalesce((select jsonb_object_agg(name,payload) from native_sheet),'{}'::jsonb)) from native_state where id=true;
$$;
create or replace function public.native_commit(p_revision bigint,p_sheets jsonb,p_deleted jsonb,p_properties jsonb,p_files jsonb,p_triggers jsonb,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
declare r bigint; prior bigint;
begin
 select revision into r from native_state where id=true for update;
 select revision into prior from native_commit_log where request_id=p_request_id;
 if prior is not null then return jsonb_build_object('revision',prior,'duplicate',true); end if;
 if r<>p_revision then raise exception 'NATIVE_REVISION_CONFLICT: data berubah; muat ulang sebelum mengulang tindakan'; end if;
 delete from native_sheet where name in (select jsonb_array_elements_text(p_deleted));
 insert into native_sheet(name,payload) select key,value from jsonb_each(p_sheets)
 on conflict(name) do update set payload=excluded.payload;
 update native_state set revision=r+1,properties=p_properties,files=p_files,triggers=p_triggers where id=true;
 insert into native_commit_log(request_id,revision) values(p_request_id,r+1);
 return jsonb_build_object('revision',r+1);
end;
$$;
revoke all on function public.native_load() from public,anon,authenticated;
revoke all on function public.native_commit(bigint,jsonb,jsonb,jsonb,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.native_load() to service_role;
grant execute on function public.native_commit(bigint,jsonb,jsonb,jsonb,jsonb,jsonb,uuid) to service_role;
insert into storage.buckets(id,name,public) values('so-files','so-files',false) on conflict(id) do nothing;
commit;
