-- Manajemen user oleh Master (Admin): set/ubah password, nonaktifkan/aktifkan, hapus.
-- Semua fungsi security definer, hanya role admin aktif yang bisa memanggil.
-- Jalankan di Supabase SQL Editor sebagai project owner (butuh pgcrypto & akses schema auth).

create extension if not exists pgcrypto with schema extensions;

-- Guard: hanya admin aktif. Mengembalikan id admin yang memanggil.
create or replace function public.tsi_so_admin_guard()
returns uuid language plpgsql security definer set search_path = '' as $$
begin
 if not exists(select 1 from public.tsi_so_users where user_id=auth.uid() and active and role='admin') then
   raise exception 'Hanya Master (Admin) yang bisa melakukan ini.';
 end if;
 return auth.uid();
end;$$;

-- Daftar user: tambah field active agar status tampil di menu Manajemen Akses.
create or replace function public.tsi_so_users_list()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare who text; body jsonb;
begin
 select role into who from public.tsi_so_users where user_id=auth.uid() and active;
 if who is distinct from 'admin' then raise exception 'Hanya Admin.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',u.user_id,'email',u.email,'full_name',coalesce(u.full_name,''),
  'name',coalesce(nullif(btrim(u.full_name),''),u.email),'role',u.role,'store_code',u.store_code,'active',u.active,
  'spv_stores',(select coalesce(jsonb_agg(a.store_code),'[]'::jsonb) from public.tsi_so_spv_stores a where a.user_id=u.user_id))
  order by coalesce(nullif(btrim(u.full_name),''),u.email)),'[]'::jsonb)
 into body from public.tsi_so_users u;
 return body;
end;$$;

-- Set / ubah password user lain. Sesi user tsb dicabut agar harus login ulang.
create or replace function public.tsi_so_admin_set_password(p_user uuid, p_password text)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; em text;
begin
 me := public.tsi_so_admin_guard();
 if p_password is null or length(p_password) < 6 then raise exception 'Password minimal 6 karakter.'; end if;
 select email into em from auth.users where id=p_user;
 if em is null then raise exception 'Akun tidak ditemukan. Minta user daftar/login dulu.'; end if;
 update auth.users set encrypted_password=extensions.crypt(p_password, extensions.gen_salt('bf')), updated_at=now()
  where id=p_user;
 delete from auth.refresh_tokens where user_id=p_user::text;
 delete from auth.sessions where user_id=p_user;
 insert into public.tsi_so_audit(user_id,event,meta) values(me,'ADMIN_PASS_SET',jsonb_build_object('target',p_user,'email',em));
end;$$;

-- Aktifkan / nonaktifkan user.
create or replace function public.tsi_so_admin_set_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; em text; tgt_role text;
begin
 me := public.tsi_so_admin_guard();
 if p_user = me and not p_active then raise exception 'Tidak bisa menonaktifkan akun sendiri.'; end if;
 select email, role into em, tgt_role from public.tsi_so_users where user_id=p_user;
 if em is null then raise exception 'User belum terdaftar di Manajemen Akses.'; end if;
 if not p_active and tgt_role='admin' and not exists(
    select 1 from public.tsi_so_users where role='admin' and active and user_id<>p_user) then
   raise exception 'Tidak bisa menonaktifkan Master terakhir.';
 end if;
 update public.tsi_so_users set active=p_active where user_id=p_user;
 if not p_active then
   delete from auth.refresh_tokens where user_id=p_user::text;
   delete from auth.sessions where user_id=p_user;
 end if;
 insert into public.tsi_so_audit(user_id,event,meta)
  values(me, case when p_active then 'ADMIN_USER_ACTIVATE' else 'ADMIN_USER_DEACTIVATE' end, jsonb_build_object('target',p_user,'email',em));
end;$$;

-- Hapus user permanen. Harus sudah nonaktif. Gagal jika user punya riwayat (SO/upload/BA),
-- karena data tersebut mereferensi akunnya; dalam kasus itu biarkan tetap nonaktif.
create or replace function public.tsi_so_admin_delete_user(p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid; em text; tgt_role text; is_active boolean;
begin
 me := public.tsi_so_admin_guard();
 if p_user = me then raise exception 'Tidak bisa menghapus akun sendiri.'; end if;
 select email, role, active into em, tgt_role, is_active from public.tsi_so_users where user_id=p_user;
 if is_active then raise exception 'Nonaktifkan akun dulu sebelum dihapus.'; end if;
 if tgt_role='admin' and not exists(
    select 1 from public.tsi_so_users where role='admin' and active and user_id<>p_user) then
   raise exception 'Tidak bisa menghapus Master terakhir.';
 end if;
 if em is null then select email into em from auth.users where id=p_user; end if;
 if em is null then raise exception 'Akun tidak ditemukan.'; end if;

 insert into public.tsi_so_audit(user_id,event,meta) values(me,'ADMIN_USER_DELETE',jsonb_build_object('target',p_user,'email',em));
 delete from auth.refresh_tokens where user_id=p_user::text;
 delete from auth.sessions where user_id=p_user;
 delete from public.tsi_so_users where user_id=p_user;
 begin
   delete from auth.identities where user_id=p_user;
   delete from auth.users where id=p_user;
 exception when foreign_key_violation then
   raise exception 'User % punya riwayat SO/upload/BA sehingga tidak bisa dihapus permanen. Biarkan dinonaktifkan saja.', em;
 end;
end;$$;

revoke all on function public.tsi_so_admin_guard() from public, anon;
revoke all on function public.tsi_so_users_list() from public, anon;
revoke all on function public.tsi_so_admin_set_password(uuid,text) from public, anon;
revoke all on function public.tsi_so_admin_set_active(uuid,boolean) from public, anon;
revoke all on function public.tsi_so_admin_delete_user(uuid) from public, anon;
grant execute on function public.tsi_so_admin_guard() to authenticated;
grant execute on function public.tsi_so_users_list() to authenticated;
grant execute on function public.tsi_so_admin_set_password(uuid,text) to authenticated;
grant execute on function public.tsi_so_admin_set_active(uuid,boolean) to authenticated;
grant execute on function public.tsi_so_admin_delete_user(uuid) to authenticated;
