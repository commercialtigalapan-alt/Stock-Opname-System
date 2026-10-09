-- Read-only verification after installing 01_database.sql.
select
 exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='native_load') as load_installed,
 exists(select 1 from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and p.proname='native_commit') as commit_installed,
 not has_function_privilege('anon','public.native_load()','EXECUTE') as anon_load_blocked,
 not has_function_privilege('authenticated','public.native_load()','EXECUTE') as authenticated_load_blocked,
 has_function_privilege('service_role','public.native_load()','EXECUTE') as server_load_allowed;
select tablename,rowsecurity from pg_tables where schemaname='public' and tablename in ('native_state','native_sheet','native_commit_log');
select id,name,public from storage.buckets where id='so-files';
select count(*) as logical_tables from public.native_sheet;
