# Hotfix v36 — Upload CSV: duplikat Nama Item

## Kasus
TPK-TRJ: KEMEJA FORMAL STEEL BLUE PDK 2XL dan ukuran lainnya pernah berulang karena spasi ganda.

## Aturan penyelesaian
- Spasi ganda, tab, dan whitespace dalam Nama Item diseragamkan menjadi spasi tunggal.
- Bila metadata (Kategori, HPP, Retail) sama dan ada baris Qty/Ending = 0, duplikat nol diabaikan. Jika satu baris lebih dari nol, jumlahnya diambil dari baris itu TANPA penjumlahan.
- Jika dua baris yang bernama sama sama-sama berisi qty positif atau metadata berbeda, upload DITOLAK. Pengguna dapat mengunduh CSV laporan seluruh konflik untuk koreksi sumber.
- Data SO, BA, dan inventory aktif tidak berubah bila file konflik.
- SQL 032 REVISI tetap berlaku. Tidak ada migrasi baru untuk perbaikan validasi di browser ini.

## Deploy
Deploy folder site/ dari paket ini ke GitHub, refresh Ctrl+F5. Tidak perlu menjalankan ulang SQL 032.

## Pengujian
node tests/test_upload_name_dedup_v36.cjs; node tests/test_name_only_v35.cjs

Penting: file migrasi 032 dalam paket ini adalah versi REVISI yang telah berhasil dijalankan pengguna. Jangan menjalankannya lagi pada database yang sudah dimigrasi. Tidak ada SQL baru untuk v36.
