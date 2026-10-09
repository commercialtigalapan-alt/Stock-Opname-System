# Stock Opname System — Tigalapan

Aplikasi Stock Opname dengan server Node.js, database Supabase, dan penyimpanan
file privat Supabase Storage. Repository ini berisi kode, bukan data perusahaan.

## Status migrasi

Pada project tujuan pengguna, impor 43 tab selesai dan data inti telah diperiksa.
Login dashboard serta uji penyimpanan konfigurasi berhasil pada komputer lokal.
Paket ini menyertakan perbaikan impor bertahap, pembacaan bertahap, cache dengan
pemeriksaan revision, dan batas tunggu login 120 detik. Deployment online belum
dijalankan dan tetap perlu diuji.

## Upload ke GitHub

Repository tujuan: https://github.com/commercialtigalapan-alt/Stock-Opname-System

1. Gunakan repository **Private**.
2. Ekstrak paket, lalu buka folder yang berisi file `Dockerfile` dan `package.json`.
3. Di GitHub pilih **Add file → Upload files**, atau tautan **uploading an existing
   file** pada repository kosong.
4. Upload isi folder tersebut, bukan ZIP dan bukan folder aplikasi lokal.
5. Commit ke branch utama. Pastikan `Dockerfile`, `package.json`, `src`, `public`,
   dan `original` berada langsung di root repository.

`.env.example` hanya contoh dengan placeholder. File `.env`, snapshot migrasi,
spreadsheet, akun layanan Google, dan arsip lokal tidak disertakan. Jangan unggah
file-file tersebut. `.gitignore` adalah perlindungan tambahan untuk alur Git;
upload manual melalui browser tetap perlu memakai paket kode ini.

## Deploy sebagai Render Web Service

GitHub Pages tidak menjalankan server Node.js aplikasi ini.

1. Masuk ke Render, pilih **New → Web Service**, lalu hubungkan repository privat
   yang disebut di atas.
2. Pilih **Docker** sebagai runtime; Dockerfile path `./Dockerfile` dan root
   directory kosong. Gunakan satu instance untuk uji awal.
3. Gunakan health check path `/health`.
4. Pilih region terdekat dengan project Supabase jika tersedia. Pilih compute plan
   setelah meninjau CPU/RAM dan biaya di dashboard. Ukuran JSON sekitar 80 MiB
   bukan ukuran pemakaian RAM: cache, array, runtime, dan Chromium menambah RAM.
   Rencana awal 2 GB perlu diverifikasi melalui metrik saat uji; kapasitas ini
   bukan jaminan cukup untuk seluruh beban produksi. Paket tidak membuat service
   berbayar atau menentukan plan secara otomatis.
5. Isi environment variables pada Render, bukan dalam repository:

| Nama | Nilai |
|---|---|
| `SUPABASE_URL` | URL project tujuan yang sudah berisi hasil impor |
| `SUPABASE_SECRET_KEY` | Secret/service key dari `.env` lokal; server saja |
| `SUPABASE_BUCKET` | `so-files` |
| `APP_AUTH_SECRET` | Nilai yang sama dengan `.env` lokal saat impor berhasil |
| `APP_ORIGIN` | URL HTTPS service Render, tanpa slash penutup |
| `SCHEDULER_ENABLED` | `false` selama uji dan sebelum cutover |
| `RPC_TIMEOUT_MS` | `120000` |
| `MAX_BODY_MB` | `32` |

`PORT` mengikuti environment service atau default Docker 3000. Server sudah
mendengarkan pada `0.0.0.0`. Docker menjalankan `node src/server.mjs`; environment
disediakan oleh Render, sehingga tidak membutuhkan `.env` di image. Jangan
menjalankan `npm run init` atau `npm run import` saat build/deploy: database tujuan
sudah berisi data.

Jika URL service baru belum diketahui ketika pengisian awal, gunakan nilai
sementara untuk `APP_ORIGIN`, kemudian setelah URL tersedia set ke URL HTTPS yang
tepat dan redeploy sebelum login. `/health` tidak memerlukan login, tetapi hanya
menguji server HTTP, bukan koneksi atau kebenaran data database.

## Pemeriksaan deployment

1. Pastikan build dan health check berhasil.
2. Pastikan `APP_ORIGIN` sama persis dengan URL yang dibuka di browser.
3. Uji login akun lama, dashboard, filter toko, dan detail satu SO historis.
4. Uji simpan `AUTO_REFRESH_MINUTES`, refresh, lalu kembalikan nilai awal.
5. Uji pembuatan/akses PDF, batas akses role dan akses store sebelum produksi.
6. File arsip dan tanda tangan Google Drive belum dipindahkan secara fisik.
7. Jadwalkan cutover sebelum mengaktifkan scheduler. Hentikan scheduler pada
   server lokal atau instance lain yang menggunakan database sama; server ini
   belum memakai penguncian scheduler lintas instance. Kode Apps Script lama dan
   database lama adalah sistem terpisah, sehingga transaksi baru di sana setelah
   snapshot tidak otomatis tersinkron ke database tujuan.

## Menjalankan lokal

Node.js minimal 22. Salin `.env.example` ke `.env`, isi variabel server, lalu:

```sh
npm install
npm start
```

Untuk database tujuan yang sudah diimpor, jangan menjalankan init/import lagi.
Database baru saja memerlukan SQL bootstrap dan importer; SQL di folder `sql`
disertakan untuk instalasi baru/referensi, bukan instruksi reset database aktif.

## Validasi paket

44 pengujian aplikasi tersedia dan lulus setelah perbaikan pembacaan dipasang.
Simulasi dataset lengkap memverifikasi 43 tab, pembacaan 394 bagian, pengurutan
baris, tanggal, cache, serta penolakan pembacaan gagal atau revision berubah.
Docker image belum dibangun di lingkungan penyusunan paket ini. Build Render,
RAM, akses PDF, performa jaringan dan deployment online perlu diuji aktual.

Referensi:
- https://render.com/docs/web-services
- https://render.com/docs/docker
- https://render.com/docs/health-checks
- https://render.com/docs/configure-environment-variables
- https://render.com/docs/compute-plans
- https://render.com/pricing
