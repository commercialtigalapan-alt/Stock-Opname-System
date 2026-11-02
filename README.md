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
