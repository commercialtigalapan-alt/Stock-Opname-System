# Hotfix 029 - Error Upload & Ganti Inventory

**Gejala:** saat menekan `Upload & Ganti Inventory`, muncul `DELETE requires a WHERE clause`.

**Penyebab pada source v31:** RPC `public.tsi_so_upload()` yang dipasang oleh migrasi 028 memakai perintah `DELETE FROM pg_temp._up028_rekey;` tanpa kondisi. Di lingkungan PostgreSQL yang mengaktifkan perlindungan DELETE, statement ini ditolak. Tabel `_up028_rekey` hanya digunakan untuk persiapan sinkronisasi SKU pada SO aktif.

**Perbaikan:** migrasi `202611020029_fix_upload_delete_where.sql` memasang ulang fungsi yang sama, dengan hanya satu perbedaan pada operasi tabel sementara menjadi `TRUNCATE TABLE pg_temp._up028_rekey;`.

## Langkah penerapan

1. Backup database Supabase. Pastikan migrasi 028 sudah terpasang.
2. Supabase -> SQL Editor -> New query -> buka dan jalankan isi `supabase/migrations/202611020029_fix_upload_delete_where.sql`.
3. Pastikan SQL Editor memberi hasil `Success`. Tidak perlu redeploy frontend/GitHub agar hotfix ini berlaku untuk aplikasi v31 yang sudah aktif.
4. Kembali ke Upload Inventory, pilih file CSV, periksa preview jumlah SKU resmi/PENDING, klik `Upload & Ganti Inventory`.
5. Periksa notifikasi berhasil, riwayat upload bertambah sekali, dan jumlah inventory serta baris SO aktif sesuai.

## Batasan

- Migrasi hanya memperbarui fungsi; **tidak menjalankan proses upload** atau menghapus data.
- Jika percobaan upload sebelumnya gagal di tengah RPC, PostgreSQL seharusnya me-rollback keseluruhan transaksi yang gagal, tetapi tetap periksa data aktual.
- Upload setelah hotfix masih mungkin gagal untuk konflik SKU, data tidak valid, atau hak akses; jika ada error baru, cek teks error lengkapnya.
- Backup sebelum menjalankan SQL tetap dianjurkan. Jangan menonaktifkan proteksi DELETE pada database.
