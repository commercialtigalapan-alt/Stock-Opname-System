-- 202610280007: perbaiki nama toko TPK-PLM (sebelumnya "Tigalapankaos Palopo").
-- Jalankan SETELAH 202610280006_user_names_upload_history.sql. Aman dijalankan ulang.
update public.tsi_so_stores set name='Tigalapankaos Polman' where code='TPK-PLM' and name<>'Tigalapankaos Polman';
