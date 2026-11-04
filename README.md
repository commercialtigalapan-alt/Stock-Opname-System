> **Update v37 — 4 November 2026:** Perbaikan error `DELETE requires a WHERE clause` pada Sinkronisasi Rasio; buka kunci item sekali pakai oleh Master/Admin; statistik warna berbasis rasio item; audit semua toko. Lihat `PANDUAN_034_BUKA_KUNCI_MASTER.md` dan migrasi `202611040034_master_item_unlock_and_coverage_fix.sql`. Jangan mengubah rasio historis tanpa audit.

# SO Tigalapan — Supabase + GitHub Pages

Aplikasi web Stock Opname untuk 12 toko Tigalapan Indonesia. **Satu aplikasi, satu database PostgreSQL dengan `store_code` pada tiap inventaris dan siklus SO**. Role STORE, SPV, ADMIN dibatasi oleh backend RPC. Proyek SQL hanya membuat tabel/fungsi prefix `tsi_so_` agar tidak mengganggu tabel aplikasi lainnya.

**Status:** kode siap dipasang; SQL **belum dieksekusi** pada proyek Supabase, repository GitHub **belum di-push**, GitHub Pages **belum di-deploy**. Data bisnis historis **belum dimigrasikan**; daftar 12 toko saja yang di-seed. Uji pilot sebelum operasional.

## Tujuan dan fitur

- Login Supabase Auth memakai email+password; login Google OAuth tersedia **jika provider Google sudah disetel**.
- Dashboard toko, dashboard area SPV, dan dashboard Master untuk Admin.
- Upload CSV (`SKU, NAME_VARIANT, CATEGORY, ENDING, COST`) mengganti inventory aktif satu toko dalam satu transaksi. Maksimum 5.000 SKU per upload.
- Mulai SO mengunci stok awal. Upload ulang inventory hanya mengubah sistem terbaru, tidak mengubah baseline SO.
- Counting Gudang+Display, total fisik, pagination 50 SKU, progress dan status TALLY/SELISIH baru setelah submit.
- PIN tambahan 8–12 digit dan unlock server 15 menit untuk membuka fungsi SPV; batas 5 kesalahan sebelum blokir 15 menit.
- Recount, validasi perubahan actual, alasan selisih sebelum approval, KPI Accuracy SKU/Qty/Value, export adjustment CSV.
- Tabel sensitif tidak dapat dibaca langsung oleh `anon`/`authenticated`: RLS ON dan akses tabel REVOKED. Seluruh operasi melalui stored functions yang mengecek role dari `auth.uid()`.

## Pasang di Supabase

1. Pastikan membuka proyek **`nvqfipfrvvghobcprowp`**, bukan proyek Commercial lain. Buat backup terlebih dahulu jika proyek sudah digunakan.
2. Supabase Dashboard → **SQL Editor** → New query. Salin seluruh isi `supabase/migrations/202610260001_tsi_so_schema.sql`, lalu **Run**. Jalankan di proyek dengan hak pemilik/SQL Editor. Periksa SQL berhasil tanpa error.
3. Supabase → **Authentication → Users** → buat user `operational@tigalapanindonesia.com` dengan email/password, atau daftarkan dari aplikasi setelah dipublikasikan. Gunakan email yang benar-benar dimiliki perusahaan.
4. Di SQL Editor jalankan bootstrap admin **secara terpisah sesudah user Auth sudah terdaftar**:

```sql
insert into public.tsi_so_users(user_id,email,role)
select id,email,'admin' from auth.users
where lower(email)='operational@tigalapanindonesia.com'
on conflict(user_id) do update set role='admin',email=excluded.email,store_code=null,active=true;
```

5. Cek hasil `select email,role from public.tsi_so_users;`, harus berisi akun `operational@...` role `admin`.
6. Lihat `site/config.js`; URL dan **publishable key** sudah diisi dari informasi yang diberikan. Jangan mengisi secret key apapun dalam `site/`.
7. Supabase → **Authentication → URL Configuration**. Tambahkan URL GitHub Pages dalam *Site URL* / *Redirect URLs*: `https://commercialtigalapan-alt.github.io/Stock-Opname-System/`. Sesuaikan jika domain, case atau nama repositori berubah.
8. Login dengan Google hanya akan bekerja jika **Authentication → Providers → Google** dan kredensial OAuth sudah dikonfigurasi secara sah. Tanpa itu, gunakan email/password. Email @gmail.com tetap boleh dipakai sebagai email akun Supabase Auth.

## Pasang di GitHub

1. Buka repository `https://github.com/commercialtigalapan-alt/Stock-Opname-System.git` menggunakan akun GitHub pemilik repo.
2. Unggah **seluruh isi folder proyek ini** ke root branch `main` (termasuk `.github/workflows/deploy.yml`, `site/`, `supabase/`, dan README). Bisa melalui git clone/push atau Upload files GitHub. Hindari mengunggah ZIP sebagai satu file; ekstrak terlebih dahulu.
3. Buka **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Buka **Actions**, lihat workflow **Publish Stock Opname to GitHub Pages**. Jika gagal, baca error Actions. Setelah sukses, aplikasi biasanya tersedia di `https://commercialtigalapan-alt.github.io/Stock-Opname-System/`.
5. Workflow mempublikasikan **hanya folder `site/`**, sehingga file SQL dan dokumentasi tidak masuk ke artefak website.

## Aktifkan pengguna toko / SPV

1. Setiap toko mendaftar dengan email Gmail pribadi masing-masing menggunakan halaman Login → Daftar akun (perlu konfirmasi email jika diaktifkan); gunakan satu akun Gmail per toko seperti kesepakatan sebelumnya.
2. Admin login → **Manajemen Akses** → akun menunggu → pilih Role `STORE` dan nama toko → Aktifkan User. Untuk SPV pilih `SPV`, lalu tambahkan toko area tanggung jawabnya.
3. Admin atur PIN validasi untuk SPV pada daftar pengguna, atau atur PIN sendiri sebagai Admin.
4. Akun STORE tidak mendapat PIN SPV dan tidak mempunyai akses ke tabel stok awal, validasi, cost, atau sistem terbaru melalui API publik.
5. Setelah akses siap: STORE upload CSV → Mulai SO → input counting → Submit → SPV buka PIN → validasi → Approve / Recount.

## Keamanan dan keterbatasan

- **Kunci `sb_publishable_` memang boleh ada di frontend**. Ini bukan login user. Keamanan bergantung pada Supabase Auth, `auth.uid`, izin RPC, dan RLS. **Jangan pernah** taruh `sb_secret_`, `service_role`, GitHub PAT, atau database password di website/repo/ChatGPT.
- Tidak ada `DROP TABLE` maupun overwrite terhadap tabel Commercial. Namun script harus **direview terlebih dahulu** oleh admin proyek jika dipasang di Supabase yang sudah menjalankan aplikasi lain.
- Keamanan ini menggunakan akun Google/Gmail melalui Supabase Auth; **PIN hanya lapisan tambahan**, bukan pengganti autentikasi.
- CSV toko memiliki nilai Ending, artinya petugas yang mengunggah bisa melihat angka sistem sebelum menghitung. Untuk blind counting ketat, sumber data harus diunggah petugas berbeda atau dari integrasi POS khusus.
- Kolom `COST` berasal dari upload toko. Nilai Value Accuracy hanya dapat diaudit jika biaya/HPP berasal dari sumber yang dipercaya, bukan input bebas.
- Ini bukan migrasi otomatis data transaksi lama. Tidak ada proses mengimpor data Google Sheets V4 ke Supabase dalam paket ini karena file database asli toko belum tersedia di lingkungan kerja.
- Pengujian SQL **belum dilakukan di server Supabase asli**. Uji dengan user demo, CSV contoh, jalur Store/SPV/Admin, dan batas akses lintas toko sebelum produksi.

## Struktur folder

```
site/               Web UI statis untuk GitHub Pages
site/config.js       URL proyek + kunci publishable (bukan secret)
supabase/migrations/202610260001_tsi_so_schema.sql  Tabel, role RPC, keamanan, seed toko
.github/workflows/deploy.yml                       GitHub Actions untuk Pages
CONTOH_INVENTORY.csv  Data contoh (bukan stok aktual)
README.md           Instruksi ini
```


## Update BA — kolom Alasan per SKU (2026-11-02)

Basis source: arsip commit `2c53afbd02b5147e195023548606aaebf8fb8305`.

1. Di Supabase **SQL Editor**, jalankan **hanya jika migrasi sebelumnya sudah terpasang**:
   `supabase/migrations/202610280025_ba_alasan_per_sku.sql`.
2. Deploy isi folder `site/` dengan mekanisme GitHub Pages yang sama seperti sebelumnya.
   File `site/index.html` telah memperbarui versi cache `app.js` dan `style.css`.
3. Buka **Berita Acara → Detail**. Di tabel SKU selisih akan terlihat kolom **Alasan**,
   otomatis berasal dari `spv_note` (bila ada) atau `store_note` hasil counting.
4. Sebelum tanda tangan SPV / sebelum HTML diekspor, SPV atau admin dapat memperbarui
   alasan langsung per SKU. Simpan otomatis ketika pindah kolom (blur).
5. Sesudah tanda tangan SPV atau ekspor HTML, alasan BA tidak dapat dikoreksi.
   Perubahan disimpan pada `tsi_so_ba.reason_overrides` dan perubahannya dicatat di audit.
6. **Unduh HTML** BA tunggal/gabungan dan **Cetak / PDF** menyertakan alasan untuk
   masing-masing SKU selisih. CSV Adjust Moka tidak diubah.
7. Setelah BA **dibersihkan**, `reason_overrides` dihapus sebagai bagian dari proses cleanup.

**Catatan:** kode ini belum diuji terhadap Supabase produksi; cek migrasi dan data
melalui akun SPV dan admin di lingkungan uji terlebih dahulu. Jangan menjalankan
migrasi ulang yang lebih lama setelah migration 025, karena fungsi BA yang lama dapat
menimpa perubahan ini.

Smoke test lokal: `node --check --input-type=module < site/app.js`,
`node tests/test_csv.cjs`, dan `node tests/test_ba_reason.cjs`.


## Update layout BA — Nama Item lebih lebar (2026-11-02)

- Menghapus **kolom Nilai selisih (rupiah)** hanya pada daftar SKU selisih di detail BA, cetak/PDF, dan HTML unduhan.
- Melebarkan **Nama item** (38% dari tabel) dengan tata letak 6 kolom; di layar kecil tabel digeser horizontal agar tidak terlalu banyak memecah nama item ke beberapa baris.
- Kolom SKU, System, Actual, Selisih (qty), dan Alasan tetap ada. Nilai uang pada ringkasan BA dan perhitungan dashboard **tidak berubah**.
- Perubahan ini hanya pada `site/app.js`, `site/style.css`, dan cache pada `site/index.html`. **Tidak memerlukan migrasi SQL baru** (migrasi 025 tetap dibutuhkan jika belum dipasang).
- Jalankan `node tests/test_ba_reason.cjs` dan `node tests/test_csv.cjs`; lalu publish folder `site/` seperti biasa.


## Update SKU dari Item Library (2 November 2026) — migrasi 026

Sumber: Item Library DC TIGALAPAN (7.295 baris). 6.052 mempunyai SKU resmi dan 1.243 belum memiliki SKU.

- Kolom Item Name tetap nama produk; kolom SKU menggunakan kode resmi dari Item Library berdasarkan pencocokan nama *exact* (trim/case-insensitive).
- SQL `supabase/migrations/202611020026_item_library_sku_mapping.sql` memuat mapping resmi dan memperbaiki key SKU pada inventory, detail SO yang **belum arsip/BA disahkan/diekspor**, cakupan/scope jadwal, alasan BA pada draft, dan data rasio per SKU. Semua qty/cost/reason asli dipertahankan.
- BA yang sudah ditandatangani, diekspor, atau dibersihkan serta SO yang diarsipkan **tidak ditulis ulang** untuk menjaga arsip.
- Setelah migrasi, upload inventory dengan kolom SKU kosong atau tanpa kolom SKU otomatis dicocokkan server berdasarkan Item Name. Jika item tidak cocok dan tidak mempunyai SKU eksplisit, upload akan **ditolak** agar nama item tidak digunakan kembali sebagai kode.
- Kode resmi kosong **tidak dibuat-buat**. Lihat `Item_Library_Belum_Ada_SKU_1243.csv` pada berkas pendamping.
- Migrasi harus diterapkan di proyek Supabase untuk mengubah data yang sudah tersimpan. Deploy frontend saja tidak akan memperbaiki data di database.
- **Cadangkan database Supabase dulu**, jalankan migrasi 026 setelah 025, review hasil SELECT (hasil `*_converted`), lalu deploy site/. Transaksi akan rollback jika ada benturan SKU.
- Catatan: tanpa akses database produksi, jumlah baris yang berhasil dicocokkan di database tidak dapat diketahui. Uji pada salinan database dulu.


## Update 027 — Koreksi SKU BA yang sudah ditandatangani / diekspor (2026-11-02)

1. **Backup PostgreSQL** dan arsipkan dokumen HTML/PDF BA yang sudah ditandatangani sebelum eksekusi. Hentikan upload/counting.
2. Jalankan migrasi **025 lalu 026** jika belum; kemudian jalankan **`supabase/migrations/202611020027_ba_historical_sku_correction.sql`** melalui Supabase SQL Editor pada database SO. Jangan jalankan migrasi lama sesudahnya.
3. Migrasi 027 hanya memperbaiki baris detail SKU pada BA **yang masih menyimpan detail dan belum cleaned**, termasuk yang telah ditandatangani SPV, disetujui Manager, dan diunduh sebagai HTML. **BA cleaned/terhapus permanen tidak bisa dipulihkan dari database**.
4. Catatan Qty, nilai, alasan, nomor BA, waktu dan identitas tanda tangan / approval tidak diubah. Koreksi disimpan dengan old_sku dan new_sku ke tabel `tsi_so_ba_sku_revision` dan event audit `BA_SKU_OFFICIAL_CORRECTION`. Semua perubahan dalam satu transaksi; jika ada SKU bentrok, dibatalkan semuanya.
5. Deploy `site/` untuk menampilkan label **KOREKSI KODE SKU** pada halaman Detail BA, cetakan, dan file HTML baru.
6. **Unduh ulang HTML/PDF BA yang sudah pernah diekspor** agar kode SKU dalam file sesuai hasil koreksi. File yang tersimpan di luar database tidak dapat diubah otomatis. Jika diperlukan, simpan file lama sebagai versi asli dan file baru sebagai versi revisi administratif.
7. Lakukan audit di SQL Editor dengan contoh query berikut (read-only):

```sql
select ba_no, store_code, count(*) sku_corrected, max(corrected_at) revised_at
from public.tsi_so_ba_sku_revision group by ba_no,store_code order by revised_at desc;
select ba_no, item_name, old_sku, new_sku, corrected_at
from public.tsi_so_ba_sku_revision order by corrected_at desc limit 100;
```

**Keterbatasan:** SQL belum diuji pada database produksi; hasil nyata bergantung pada kecocokan data dan kelengkapan Item Library (1.243 item tanpa SKU tidak dapat dipetakan). Jangan menganggap tanda tangan lama sebagai persetujuan baru atas dokumen revisi, karena tanda tangan tidak diperbarui.


## Update tampilan 028 — SKU kolom terpisah Counting & Validasi SPV (2026-11-02)

- Tabel Counting dan tabel Detail Validasi SPV menggunakan **kolom SKU di paling kiri** diikuti **Nama Item**, lalu semua kolom angka, alasan, dan status yang sudah ada.
- SKU ditampilkan sebagai kode resmi; jika data lama masih memakai Item Name sebagai SKU, kolom diberi penanda **Belum ada SKU**, bukan menampilkan nama item sebagai kode. Tidak ada perubahan pada key SKU yang dipakai untuk perhitungan dan penyimpanan.
- Pembagian lebar tabel menggunakan persentase dan minimal width yang sesuai input kalkulator Counting; pada tablet/HP scroll horizontal di dalam tabel untuk menghindari teks bertumpuk.
- **Tidak ada migrasi SQL untuk perubahan layout.** Migrasi 027 yang disertakan adalah untuk koreksi SKU BA historis yang sebelumnya diminta. Urutan migrasi: 025 → 026 → 027.


## Update layout Counting & Validasi (2026-11-02, v30)

- Kolom SKU, Nama Item, input posisi, Total, Alasan, Status dibuat proporsional memakai `<colgroup>` agar jumlah lebarnya tepat 100%.
- Pada desktop dengan lebar aplikasi cukup (sekitar 1280 px layar saat sidebar terbuka), seluruh kolom Counting sampai Status terlihat tanpa scroll ke samping.
- Pada perangkat sempit, hanya tabel yang dapat digeser horizontal; fungsi kalkulator, input, dan status tidak diubah.
- Cache CSS/JS di `site/index.html` dinaikkan ke `20261102-fit-count-v030`. Setelah deploy, lakukan hard refresh bila perlu.
- Pembaruan ini hanya frontend; tidak perlu menjalankan migrasi Supabase baru.

## Update 028 — Upload Inventory ketika sebagian item tidak memiliki SKU resmi (2 November 2026)

**Masalah:** Migrasi 026 sengaja menolak seluruh upload ketika satu atau lebih nama item tidak memiliki SKU resmi pada Item Library. Contoh `ABU MISTY + RIB 2XL` dari screenshot tidak ada dalam Item Library yang diunggah; melewati baris ini diam-diam akan mengurangi stok saat inventory diganti.

**Solusi 028:**
1. Wajib backup dahulu. Pastikan migrasi 025, 026, dan 027 yang diperlukan sudah dipasang, lalu jalankan `supabase/migrations/202611020028_upload_inventory_pending_sku.sql` **sekali** di Supabase SQL Editor.
2. Deploy `site/` dari paket ini ke GitHub Pages (cache `v031`).
3. Saat memilih CSV di menu Upload Inventory, aplikasi meminta preview ke server: jumlah SKU resmi dari Item Library, kode eksplisit dari CSV, dan identitas PENDING; tersedia ekspor CSV seluruh item yang belum memiliki SKU.
4. Jika belum ada SKU resmi, item **tidak dihapus**. Sumber Item Library tanpa SKU mendapat ID sementara `PENDING-<Internal ID Variant>`, item yang tidak ada di Item Library mendapat `PENDING-N<MD5 NAMA NORMALISASI>`. ID tersebut bukan SKU resmi untuk Moka dan ditampilkan sebagai `SKU PENDING` di Counting/Validasi.
5. Sistem meminta konfirmasi kembali sebelum **mengganti semua inventory**. SO dalam status COUNTING/RECOUNT yang memakai nama item sebagai SKU atau ID PENDING dikonversi ke identitas baru tanpa mengubah hasil hitung/alasan/team; stok sistem diperbarui. Jadwal yang belum dimulai menyesuaikan daftar scope SKU. SO SUBMITTED dan APPROVED tidak dikoreksi oleh upload, begitu pula BA historis.
6. Jika ada SKU duplikat atau konflik pada SO aktif, transaksi akan dibatalkan untuk menjaga integritas. Setelah upload, operator wajib memuat ulang Counting/Validasi agar kode SKU pada halaman aktif mengikuti update database.
7. Untuk menghilangkan PENDING, lengkapi SKU resmi di sumber Moka Item Library lalu jalankan pembaruan pemetaan dan migrasi identitas yang aman. Jangan sekadar mengganti teks ID sementara dengan SKU baru secara manual di database.

**Keamanan data:** `tsi_so_upload_check` hanya dapat digunakan user dengan akses toko tersebut. Resolver internal tidak dapat dipanggil langsung oleh role authenticated. Test lokal: `node tests/test_upload_pending.cjs`. SQL belum diuji di Supabase produksi, lakukan pilot/backup dan cocokkan total stok.


## Hotfix 029 - Upload & Ganti Inventory (2 Nov 2026)

Jika muncul pesan `DELETE requires a WHERE clause` saat tombol **Upload & Ganti Inventory** diklik, jalankan `supabase/migrations/202611020029_fix_upload_delete_where.sql` di Supabase SQL Editor setelah migrasi 028. Perintah pembersihan tabel sementara dalam `tsi_so_upload` diubah dari `DELETE FROM pg_temp._up028_rekey` menjadi `TRUNCATE TABLE pg_temp._up028_rekey`. Hanya objek sementara yang dikosongkan. Tidak ada perubahan frontend, dan tidak perlu mengganti data inventory secara manual. Backup database sebelum perbaikan. Setelah SQL berhasil, ulangi upload dengan CSV yang sama dan periksa jumlah SKU & riwayat upload.

### Update v33 — Indikator status SKU resmi di Cakupan SKU

Tersedia rekap jumlah SKU **sudah resmi** dan **belum resmi** berdasarkan Inventory aktif setiap toko, lengkap dengan rasio persentase, filter status, dan tanda status tiap SKU. Migrasi wajib: `supabase/migrations/202611020030_cakupan_sku_resmi.sql` (dijalankan setelah migrasi 029). Panduan lengkap: `PANDUAN_030_CAKUPAN_SKU_RESMI.md`.


## Hotfix 031 — Upload inventory statement timeout (2026-11-02)

Jika `Upload & Ganti Inventory` menampilkan `canceling statement due to statement timeout` saat file 8.000+ SKU, jalankan `supabase/migrations/202611020031_optimize_inventory_upload_timeout.sql` di Supabase SQL Editor setelah migrasi 029/030. Perbaikan menggunakan pemetaan SKU dengan indexed temporary staging, tidak mengubah aturan bisnis dan tidak perlu deploy ulang frontend. Panduan: `HOTFIX_031_UPLOAD_TIMEOUT.md`.

## Update v35 (2 Nov 2026): Identitas Nama Item, tanpa kolom SKU
Aplikasi pada versi ini menggunakan Nama Item yang dinormalisasi sebagai kunci operasional. Upload inventory cukup menggunakan Item Name/Name - Variant dan Ending. Kolom SKU dihilangkan dari tampilan Counting, Validasi, Cakupan, Berita Acara, dan ekspor hasil SO; color map diperluas. **Wajib** menjalankan migrasi `202611020032_item_name_identity.sql` terlebih dahulu, setelah migrasi 031. Lihat `PANDUAN_032_NAMA_ITEM_DAN_WARNA.md` untuk pengamanan, kondisi konflik dan catatan BA historis.
