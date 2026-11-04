# Tigalapan Stock Opname v37 — Perbaikan kunci item dan Sinkronisasi Rasio

Baseline: **v36 berbasis Nama Item**. Tidak mengembalikan kode SKU resmi. Kolom teknis database `sku` tetap menyimpan Nama Item untuk kompatibilitas.

## Apa yang diperbaiki

1. Kesalahan `DELETE requires a WHERE clause` pada **Cakupan Item → Cek Perubahan/Sinkronisasi Rasio**, yang berasal dari fungsi lama `tsi_so_rounds_resync` pada migrasi 026. SQL 034 menggantinya dengan query yang tidak menggunakan DELETE tanpa filter.
2. Statistik warna yang sebelumnya menganggap semua item yang ada **sekarang** ikut ter-SO ketika jadwal lama berjenis GRAND. Setelah SQL 034, statistik warna dihitung dari rasio item yang tersimpan (bukan pencocokan GRAND dengan inventory saat ini).
3. Status **Bisa dipilih/Terkunci** di Cakupan Item, builder jadwal, dan statistik warna sekarang memakai fungsi eligibility yang sama.
4. Master/Admin dapat **Buka Kunci** satu item atau maksimal 50 item pada toko yang sama, dengan alasan wajib. Tindakan ini tidak mengubah rasio historis, Counting, BA, atau approval.
5. Pembukaan kunci aktif untuk satu SO berikutnya. Otomatis dikonsumsi saat SO baru disubmit. Jika jadwal dibatalkan sebelum submit, izin belum dikonsumsi. Izin juga dapat dicabut Master/Admin.
6. Item yang benar-benar memiliki rasio 0x selalu bisa dipilih. Jika sistem mencatat rasio di atas nol tetapi pengguna yakin item belum pernah SO, perlu audit; jangan mereset rasio sembarangan.

## Urutan penerapan

1. Backup penuh Supabase, terutama `tsi_so_inventory`, `tsi_so_sku_rounds`, `tsi_so_cycles`, `tsi_so_lines`, `tsi_so_ba`, dan `tsi_so_audit`.
2. Pastikan migrasi **032 revisi** sudah berhasil; SQL 034 bergantung pada identitas berbasis Nama Item.
3. Jalankan `supabase/migrations/202611040034_master_item_unlock_and_coverage_fix.sql` lewat Supabase SQL Editor.
4. Deploy folder `site/` aplikasi v37 ke GitHub Pages, sesuai deploy workflow yang saat ini dipakai.
5. Refresh `Ctrl+F5` dan buka menu **Cakupan Item**.
6. Untuk membuka kunci, pilih toko dan item → **Buka Kunci** → masukkan alasan (minimal 5 karakter). Untuk beberapa item, centang dan klik **Buka Kunci Pilihan**.
7. Buka **SO Schedule → Partial SO**, pilih category/warna atau item manual; cek status dan jumlah item yang bisa dijadwalkan sebelum menyimpan.
8. Uji pada satu toko dahulu, lalu audit semua toko dengan SQL `AUDIT_034_SEMUA_TOKO_READ_ONLY.sql` dan `AUDIT_034_DETAIL_ITEM_REVIEW.sql`.

## Pengamanan

- SQL 034 **tidak** mereset `tsi_so_sku_rounds` atau mengubah `tsi_so_lines`/BA. Izin tambahan disimpan terpisah pada `tsi_so_item_unlocks`.
- Fungsi sinkronisasi rasio bisa diperiksa tanpa mengubah data. Penerapan sinkronisasi akan **ditolak** bila SO tersimpan tidak lagi mempunyai detail lengkap.
- Detail SO yang diarsipkan permanen tidak bisa diverifikasi hanya dari data saat ini. Item berasio positif tanpa detail harus diperiksa, bukan dianggap pasti salah.
- Kode pernah SO, termasuk riwayat BA, tetap dipertahankan. Tidak ada migrasi data besar atau penghapusan lintas toko.

## Tes fungsional produksi yang disarankan

- Item rasio 0x: harus **Bisa dipilih**, termasuk pada pemilihan warna untuk Partial SO.
- Item rasio di atas minimum: awalnya **Terkunci**, Master dapat membukanya; setelah membuka harus bisa dipilih pada jadwal Partial SO.
- User SPV/Store: tidak melihat tindakan membuka kunci dan RPC menolak jika dipanggil langsung.
- Toko A dan B dengan nama item sama: izin di toko A **tidak** berlaku di toko B.
- SO yang disubmit: izin sekali pakai habis; SO lama dan BA lama tetap identik.
- Cek Perubahan Rasio: tidak muncul `DELETE requires a WHERE clause`; jika detail historis dibersihkan, penerapan sinkronisasi harus ditolak dengan penjelasan.
- Verifikasi juga menu Dashboard, Upload Inventory, Counting, Validasi, Cakupan, SO Schedule, dan BA pada toko sampel.

### Batas pengujian

Tes JavaScript dan pemeriksaan struktur SQL telah dijalankan secara lokal. **Belum ada tes Supabase produksi/integrasi otomatis untuk semua toko**. Keberhasilan setiap toko harus dipastikan melalui audit SQL hasil dari database aktual.
