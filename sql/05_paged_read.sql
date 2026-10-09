-- Tambahkan fungsi baca ke project tujuan. Tidak mengubah data yang diimpor.
begin;
create or replace function public.native_read_state() returns jsonb
language sql stable security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
 select jsonb_build_object('revision',revision,'properties',properties,'files',files,'triggers',triggers)
 from native_state where id=true;
$$;

create or replace function public.native_read_manifest() returns jsonb
language sql stable security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
 select jsonb_build_object('revision',s.revision,'properties',s.properties,'files',s.files,'triggers',s.triggers,
 'sheets',coalesce((select jsonb_object_agg(name,jsonb_build_object('meta',payload-'rows',
 'rowCount',jsonb_array_length(payload->'rows'))) from native_sheet),'{}'::jsonb))
 from native_state s where s.id=true;
$$;

create or replace function public.native_read_page(p_revision bigint,p_name text,p_start integer,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp set statement_timeout='60s' as $$
declare r bigint; rows jsonb;
begin
 if p_start is null or p_start<0 or p_limit is null or p_limit<1 or p_limit>1000 then raise exception 'Rentang baca tidak valid'; end if;
 select revision into r from native_state where id=true;
 if p_revision is null or r is null or r<>p_revision then raise exception 'NATIVE_REVISION_CONFLICT: data berubah saat dibaca'; end if;
 select jsonb_path_query_array(payload,format('$.rows[%s to %s]',p_start,p_start+p_limit-1)::jsonpath)
 into rows from native_sheet where name=p_name;
 if rows is null then raise exception 'Tab tidak tersedia'; end if;
 return jsonb_build_object('rows',rows);
end;
$$;
revoke all on function public.native_read_state() from public,anon,authenticated;
revoke all on function public.native_read_manifest() from public,anon,authenticated;
revoke all on function public.native_read_page(bigint,text,integer,integer) from public,anon,authenticated;
grant execute on function public.native_read_state() to service_role;
grant execute on function public.native_read_manifest() to service_role;
grant execute on function public.native_read_page(bigint,text,integer,integer) to service_role;
notify pgrst,'reload schema';
commit;
