# Perbaikan Upload Inventory (SQL 028)

## Kesalahan pada aplikasi sebelumnya

Inventory baru gagal diunggah bila ada item belum mempunyai SKU resmi dari Item Library. Nama seperti `ABU MISTY + RIB 2XL` tidak ditemukan di Item Library sumber. Ini bukan error jaringan, melainkan validasi data pada SQL 026.

## Urutan penerapan

1. Backup database Supabase terlebih dahulu, termasuk data SKU dan BA. Hentikan sementara upload/counting.
2. Pastikan migrasi sebelumnya sudah terpasang. Jalankan `supabase/migrations/202611020028_upload_inventory_pending_sku.sql` di SQL Editor. Hanya setelah backup.
3. Upload isi folder `site/` ke GitHub, deploy via GitHub Pages.
4. Refresh Ctrl+F5. Di menu Upload Inventory pilih file CSV. Tunggu hasil cek server: `SKU resmi`, `SKU dari CSV`, `SKU Pending`.
5. Download daftar Pending dan periksa alasan per item. Jika stok perlu tetap utuh, konfirmasikan upload. File itu mengganti **seluruh** inventory aktif toko, bukan menambah baris.
6. Setelah berhasil: buka ulang Counting dan periksa SKU, posisi stok, total jumlah, status dan alasan. Cocokkan total inventaris dengan laporan asli.

## Catatan penting

- `PENDING-...` adalah **ID teknis sementara**, bukan SKU resmi. Jangan kirim sebagai kode SKU ke Moka.
- Data dengan SKU resmi tetap mendapat kode dari Item Library, tanpa memprioritaskan nama atau SKU lama dalam CSV.
- Baris tanpa SKU resmi tetap ada, tidak diskip. SQL memakai transaksi atomik dan menolak konflik kode.
- Upload tidak mengubah BA signed/exported dan SO SUBMITTED/APPROVED.
- SQL belum dieksekusi atau diuji di Supabase produksi. Pengujian lokal hanya memeriksa parser, hasil pemetaan dari sumber, dan integrasi kode statis. Uji pada lingkungan cadangan sebelum produksi.
