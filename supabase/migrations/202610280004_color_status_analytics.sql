-- 202610280004: nama warna fleksibel, status per baris untuk counting, dan analitik per toko/area.
-- Jalankan setelah 202610280003_positions_live_system_cleanup.sql.

-- 1) Nama warna: dibaca dari nama item.
--    Pola Tigalapan "ABU TUA 24S PJG S" -> ABU TUA (tetap).
--    Pola lain (MAMU, dst.) "BOWLING SHIRT DENIM L" dengan category "BOWLING SHIRT" -> DENIM.
--    Kategori di depan dan ukuran di belakang dibuang; sisanya adalah warna.
create or replace function public.tsi_so_color_name(p_name text, p_category text)
returns text language sql immutable as $$
 with x as (select upper(btrim(coalesce(p_name,''))) n, upper(btrim(coalesce(p_category,''))) c),
 y as (select case
    when x.n ~ '^.*?\s+\d+S(\s|$)' then substring(x.n from '^(.*?)\s+\d+S(\s|$)')
    when x.c<>'' and starts_with(x.n, x.c||' ') then substr(x.n, length(x.c)+2)
    else x.n end v from x),
 z as (select regexp_replace(' '||y.v, '(\s+(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|[2-6]XL|ALL\s?SIZE|FREE\s?SIZE|\d{1,3}))+$', '') v from y)
 select coalesce(nullif(btrim(z.v),''),'TANPA WARNA') from z
$$;

-- Ganti pemakai nama warna lama agar memakai category juga.
create or replace function public.tsi_so_rule_match(p_rule jsonb, p_sku text, p_category text, p_name text)
returns boolean language sql immutable as $$
 select coalesce(
   (p_rule->'skus') ? p_sku
   or ((p_rule->'categories') ? p_category
       and (not ((p_rule->'colors') ? p_category)
            or ((p_rule->'colors')->p_category) ? public.tsi_so_color_name(p_name, p_category))),
   false)
$$;

create or replace function public.tsi_so_color_stats(p_store text, p_category text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text; body jsonb;
begin
 r:=public.tsi_so_authorize(p_store,true);
 if r not in ('admin','spv') then raise exception 'Hanya Admin dan SPV.'; end if;
 with inv as (
   select public.tsi_so_color_name(i.item_name, i.category) color, i.sku from public.tsi_so_inventory i
   where i.store_code=p_store and i.category=p_category),
 cnt as (select color, count(*) sku_count from inv group by color),
 cy as (select c.id, c.planned_date, c.scope_skus from public.tsi_so_cycles c
   where c.store_code=p_store and c.status<>'SCHEDULED'),
 hit as (select cy.id, cy.planned_date, inv.color from cy join inv
   on (cy.scope_skus is null or inv.sku in (select jsonb_array_elements_text(cy.scope_skus)))),
 st as (select color, count(distinct id) so_count, max(planned_date) last_date from hit group by color)
 select coalesce(jsonb_agg(jsonb_build_object('color',cnt.color,'sku_count',cnt.sku_count,
   'so_count',coalesce(st.so_count,0),'last_date',st.last_date) order by cnt.sku_count desc, cnt.color),'[]'::jsonb) into body
 from cnt left join st on st.color=cnt.color;
 return body;
end;$$;

-- 2) Status satu baris (dipakai setelah input counting, tanpa membuka system ke Store).
create or replace function public.tsi_so_row_status(p_cycle uuid, p_sku text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.tsi_so_cycles%rowtype; l public.tsi_so_lines%rowtype; r text; a bigint; st text;
begin
 select * into c from public.tsi_so_cycles where id=p_cycle;
 if not found then raise exception 'SO tidak ditemukan.'; end if;
 r:=public.tsi_so_authorize(c.store_code,true);
 select * into l from public.tsi_so_lines where cycle_id=p_cycle and sku=p_sku;
 if not found then raise exception 'SKU tidak ada pada SO ini.'; end if;
 a:=public.tsi_so_actual(l);
 st:=case when a is null then 'BELUM' when a=l.system_at_start then 'TALLY' else 'SELISIH' end;
 return jsonb_build_object('status',st,'total',a,'delta',case when a is null then null else a-l.system_at_start end);
end;$$;

-- 3) Analitik per toko (untuk rekap per area dan per toko). Memakai tsi_so_kpi sehingga angkanya konsisten.
create or replace function public.tsi_so_store_analytics(p_type text default null, p_from date default null, p_to date default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u public.tsi_so_users%rowtype; s record; k jsonb; out jsonb:='[]'::jsonb;
begin
 select * into u from public.tsi_so_users where user_id=auth.uid() and active;
 if not found then raise exception 'Tidak memiliki akses SO.'; end if;
 for s in
  select st.code, st.name, st.area,
   (select x.email from public.tsi_so_spv_stores a join public.tsi_so_users x on x.user_id=a.user_id
     where a.store_code=st.code order by x.email limit 1) spv_email
  from public.tsi_so_stores st
  where st.active and (u.role='admin' or (u.role='store' and st.code=u.store_code)
    or (u.role='spv' and exists(select 1 from public.tsi_so_spv_stores a where a.user_id=u.user_id and a.store_code=st.code)))
  order by st.area, st.name
 loop
  k:=public.tsi_so_kpi(s.code,p_type,p_from,p_to);
  out:=out||jsonb_build_array(jsonb_build_object('code',s.code,'name',s.name,'area',s.area,'spv',coalesce(s.spv_email,''))||k);
 end loop;
 return out;
end;$$;

revoke all on function public.tsi_so_color_name(text,text) from public, anon;
grant execute on function public.tsi_so_color_name(text,text) to authenticated;
revoke all on function public.tsi_so_color_stats(text,text) from public, anon;
grant execute on function public.tsi_so_color_stats(text,text) to authenticated;
revoke all on function public.tsi_so_row_status(uuid,text) from public, anon;
grant execute on function public.tsi_so_row_status(uuid,text) to authenticated;
revoke all on function public.tsi_so_store_analytics(text,date,date) from public, anon;
grant execute on function public.tsi_so_store_analytics(text,date,date) to authenticated;
