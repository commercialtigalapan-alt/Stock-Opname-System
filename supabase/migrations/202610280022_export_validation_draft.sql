-- Export CSV draft dari menu Validasi SPV: SO yang masih SUBMITTED (belum APPROVED) boleh diexport.
-- Hanya mengubah guard status pada tsi_so_export. Export draft tidak menandai SO (exported_at tidak diubah).
-- Jalankan SETELAH 202610280021_parallel_so.sql. Aman dijalankan ulang.

create or replace function public.tsi_so_export(p_cycle uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; body jsonb;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 perform public.tsi_so_require_spv(c.store_code);
 if c.status not in ('SUBMITTED','APPROVED') or c.archived_at is not null then
   raise exception 'Export hanya untuk SO SUBMITTED atau APPROVED yang belum diarsipkan.';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('SKU',l.sku,'NAME_VARIANT',l.item_name,'CATEGORY',l.category,'TEAM',l.team,
 'SYSTEM_AT_START',l.system_at_start,'DISPLAY',l.pos_display,'REJECT',l.pos_reject,'RAK_UTAMA',l.pos_rak_utama,'RAK_CADANGAN',l.pos_rak_cadangan,
 'ACTUAL',coalesce(l.validated_qty,public.tsi_so_actual(l)),
 'ADJUSTMENT',coalesce(l.validated_qty,public.tsi_so_actual(l))-l.system_at_start,'UNIT_COST',l.unit_cost,
 'REASON',coalesce(nullif(l.spv_note,''),l.store_note)) order by l.sku),'[]'::jsonb) into body
 from public.tsi_so_lines l where l.cycle_id=p_cycle;
 return body;
end;$$;

revoke all on function public.tsi_so_export(uuid) from public, anon;
grant execute on function public.tsi_so_export(uuid) to authenticated;
