-- 202610280011: SO hanya boleh dibersihkan setelah CSV-nya diexport (dicatat di database).
-- Jalankan SETELAH 202610280010_rounds_resync.sql. Aman dijalankan ulang.

alter table public.tsi_so_cycles add column if not exists exported_at timestamptz;

create or replace function public.tsi_so_mark_exported(p_cycles uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare cid uuid; cnt int:=0; c public.tsi_so_cycles%rowtype;
begin
 if p_cycles is null or coalesce(array_length(p_cycles,1),0)=0 then return 0; end if;
 foreach cid in array p_cycles loop
  select * into c from public.tsi_so_cycles where id=cid;
  if not found then continue; end if;
  perform public.tsi_so_require_spv(c.store_code);
  update public.tsi_so_cycles set exported_at=now() where id=cid;
  cnt:=cnt+1;
 end loop;
 return cnt;
end;$$;

revoke all on function public.tsi_so_mark_exported(uuid[]) from public, anon;
grant execute on function public.tsi_so_mark_exported(uuid[]) to authenticated;

-- dari 202610280003_positions_live_system_cleanup.sql
CREATE OR REPLACE FUNCTION public.tsi_so_archive_cycle(p_cycle uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare c public.tsi_so_cycles%rowtype; x record;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle for update;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status<>'APPROVED' then raise exception 'Hanya SO APPROVED yang bisa diarsipkan.'; end if;
 if c.archived_at is not null then raise exception 'SO ini sudah diarsipkan.'; end if;
 if c.exported_at is null then raise exception 'Export CSV dulu (simpan ke Drive) sebelum dibersihkan.'; end if;
 select count(*) total_skus,
  count(*) filter(where l.a=l.system_at_start) tally_count,
  count(*) filter(where l.a<>l.system_at_start) variance_count,
  sum(l.system_at_start)::numeric sys_qty,
  sum(abs(l.a-l.system_at_start))::numeric abs_qty_diff,
  sum(l.a-l.system_at_start)::numeric net_qty_diff,
  sum(l.system_at_start*l.unit_cost)::numeric sys_value,
  sum(abs(l.a-l.system_at_start)*l.unit_cost)::numeric abs_value_diff,
  sum(greatest(l.system_at_start-l.a,0)*l.unit_cost)::numeric missing_value,
  sum(greatest(l.a-l.system_at_start,0)*l.unit_cost)::numeric surplus_value
 into x from (
  select s.system_at_start, s.unit_cost, coalesce(s.validated_qty,public.tsi_so_actual(s)) a
  from public.tsi_so_lines s where s.cycle_id=p_cycle) l;
 update public.tsi_so_cycles set archived_at=now(),
  total_skus=x.total_skus, tally_count=x.tally_count, variance_count=x.variance_count,
  sys_qty=x.sys_qty, abs_qty_diff=x.abs_qty_diff, sys_value=x.sys_value, abs_value_diff=x.abs_value_diff,
  net_qty_diff=x.net_qty_diff, missing_value=x.missing_value, surplus_value=x.surplus_value
 where id=p_cycle;
 delete from public.tsi_so_lines where cycle_id=p_cycle;
 insert into public.tsi_so_audit(user_id,store_code,event,meta)
 values(auth.uid(),c.store_code,'ARCHIVE',jsonb_build_object('cycle_id',p_cycle,'skus',x.total_skus));
 return jsonb_build_object('cycle_id',p_cycle,'archived_skus',coalesce(x.total_skus,0));
end;$$;
