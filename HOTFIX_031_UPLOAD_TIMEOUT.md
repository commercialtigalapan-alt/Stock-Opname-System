# Hotfix 031 — Upload Inventory statement timeout

## Masalah
Fungsi upload 029 mencocokkan ribuan nama item dari JSON dengan setiap baris SO aktif berulang kali. Ketika 8.021 item diunggah, pencocokan join ini dapat sangat berat dan berakhir dengan pesan `canceling statement due to statement timeout`.

## Solusi
* Resolver master SKU sekarang memakai primary-key `item_key`, bukan fungsi regex pada kedua sisi join.
* Data upload dibuat sekali dalam tabel sementara dengan indeks nama/SKU.
* Pemeriksaan konflik, pemetaan SKU aktif, dan sinkronisasi stok memakai tabel berindeks.
* Scope jadwal menggunakan lookup alias sementara berindeks, bukan pencarian tiap baris ke seluruh inventory.
* System qty hanya diperbarui bila berubah; COUNTING tetap mempertahankan quantity aktual dan catatan.

## Cara memasang
1. Backup Supabase; lakukan di saat aktivitas upload/counting berhenti sementara.
2. Pastikan migrasi 028, 029, dan 030 sudah sukses.
3. Buka Supabase SQL Editor dan jalankan `supabase/migrations/202611020031_optimize_inventory_upload_timeout.sql`.
4. Pastikan `Success`, lalu coba lagi Upload & Ganti Inventory (dengan file yang sama).
5. Verifikasi riwayat upload, jumlah SKU toko, dan SO COUNTING. Jika masih timeout, catat jam tepat dan error lengkap; evaluasi database query plan sebelum mengubah batas timeout.

**Tidak perlu deploy GitHub ulang** untuk hotfix SQL ini. Jangan ubah `statement_timeout` atau menghapus filter toko. Seluruh upload tetap 1 transaksi: error menggagalkan semua perubahan.

**Batas verifikasi:** Pengujian statis dan unit lokal saja; tidak terhubung langsung ke database produksi. Kinerja dan keberhasilan nyata perlu diverifikasi setelah SQL diterapkan.
