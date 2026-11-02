# Update v35 — Nama Item sebagai identitas Stock Opname

## Perubahan
- Frontend: kolom SKU tidak ditampilkan lagi pada Counting, Validasi, Cakupan Item, BA, cetak, HTML, dan ekspor hasil SO.
- Nama Item satu-satunya dasar pencocokan inventory dan baris SO; CSV upload minimal memuat `Item Name` / `Name - Variant` dan `Ending`, serta `Category` bila tersedia.
- Data SO, rasio, jadwal, dan alasan BA yang **masih ada di database** diselaraskan dengan Nama Item menggunakan migrasi SQL `032`.
- Perluasan warna mencakup warna Tigalapan/MAMU; file `WARNA_MAPPING_REVIEW.csv` memuat label yang dideteksi, contoh, dan yang masih perlu verifikasi.
- Lebar kolom pada Counting, Validasi dan BA dirancang proporsional tanpa kolom SKU (desktop, scroll hanya di layar sempit).

## Peringatan penting
- **Backup penuh Supabase terlebih dahulu** (inventaris, detail SO, rasio, BA, audit).
- Hentikan sementara upload/Counting/Validasi/approval selama migrasi.
- Jalankan SQL 032 **setelah** migrasi 031. SQL bertransaksi dan membatalkan seluruh perubahan bila menemukan nama item ganda, konflik rasio, atau konflik alasan BA. Bila gagal, laporkan pesan error dan perbaiki hanya datanya yang berkonflik sebelum mengulang.
- Setelah SQL berhasil, deploy semua isi `site/` ke GitHub Pages. Versi cache frontend diubah menjadi `v035`.
- Reload Ctrl+F5, uji upload inventory sampel, Counting, Validasi, Cakupan Item, dan BA lama yang masih dapat dibuka.
- **Jangan** mengubah nama produk di CSV tanpa proses penyesuaian; ejaan/variasi yang berbeda berarti item yang berbeda. Persamaan menggunakan UPPER + spasi tunggal, bukan fuzzy matching.
- Dokumen HTML/PDF BA yang sudah diunduh sebelum perubahan tidak berubah otomatis dan perlu **diunduh ulang**. BA yang sudah dibersihkan dari database tidak dapat diterbitkan ulang dari aplikasi.
- Kolom internal bernama `sku` masih ada pada skema PostgreSQL demi kompatibilitas RPC, tetapi **isinya sekarang kunci Nama Item yang dinormalisasi**, bukan kode SKU. Histori audit kode lama tetap dipertahankan agar dapat ditelusuri.
- Penghilangan kode SKU **tidak otomatis memperkecil ukuran database**; nama item bisa lebih panjang dari SKU. Yang dikurangi adalah lookup ke Item Library saat upload dan kompleksitas pemetaan kode.

## Tahap penerapan
1. Backup database + verifikasi backup.
2. Nonaktifkan sementara transaksi upload/counting/approve di aplikasi.
3. Jalankan seluruh `supabase/migrations/202611020032_item_name_identity.sql` melalui SQL Editor.
4. Pastikan transaksi berhasil; bila ada konflik, jangan paksa penggabungan nama.
5. Deploy frontend dari `site/`.
6. Uji di toko sampel dan BA historis, kemudian aktifkan kembali operasional.

## Keluaran lama
- `tsi_so_ba_sku_revision`, `tsi_so_audit`, serta master Item Library historis tidak dihapus secara destruktif; tabel tersebut tidak lagi digunakan sebagai dasar upload. Bisa dievaluasi untuk arsip terpisah setelah migrasi production tervalidasi.
