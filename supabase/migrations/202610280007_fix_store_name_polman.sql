-- 202610280007: perbaiki nama toko TPK-PLM menjadi Tigalapankaos Polman dan area AREA-SULBAR.
-- Jalankan SETELAH 202610280006_user_names_upload_history.sql. Aman dijalankan ulang.
update public.tsi_so_stores set name='Tigalapankaos Polman' where code='TPK-PLM' and name<>'Tigalapankaos Polman';
update public.tsi_so_stores set area='AREA-SULBAR' where code='TPK-PLM' and area is distinct from 'AREA-SULBAR';
