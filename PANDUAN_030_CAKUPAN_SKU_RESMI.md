# Pembaruan v33 — Cakupan SKU Resmi vs Belum Resmi

## Fungsi baru
Menu **Cakupan SKU** menampilkan jumlah SKU yang **resmi** (kode di Inventory aktif toko sesuai `official_sku` dalam Item Library pada tabel `tsi_so_item_sku_map`) dan **belum resmi / belum terverifikasi** (termasuk SKU `PENDING-` dan SKU dari CSV yang belum tercatat pada master). Indikator bersifat **per toko**, tidak dihitung dari total 7.295 item Item Library.

Dua angka diambil dari seluruh inventory aktif dan tidak dibatasi 50 baris pagination, filter status SO, maupun pencarian. Total kedua kategori harus sama dengan total SKU pada toko. Rasio SO (`Sudah di-SO`, `Belum di-SO`, `Bisa dipilih`, dan `Terkunci`) dipertahankan tanpa perubahan aturan. Tersedia filter **SKU resmi** dan **Belum resmi**, serta kolom **SKU Resmi** pada daftar.

## Instalasi
1. Cadangkan database Supabase.
2. Pastikan migrasi 026 (Item Library), 028 (Upload PENDING), dan 029 (hotfix upload) sudah diterapkan.
3. Buka Supabase → SQL Editor → New query, jalankan keseluruhan isi `supabase/migrations/202611020030_cakupan_sku_resmi.sql`.
4. Deploy frontend di folder `site` ke GitHub Pages menggunakan konfigurasi sebelumnya, kemudian refresh dengan **Ctrl+F5**.
5. Buka menu **Cakupan SKU**, pilih toko, pastikan dua angka SKU resmi + belum resmi = total SKU; klik filter *Belum resmi* untuk memeriksa item-itemnya.

## Batasan
- Migrasi **tidak mengubah/menghapus** inventory, counting, validasi SPV, BA, atau histori.
- SKU dari CSV tidak otomatis dianggap resmi hanya karena formatnya menyerupai kode. Kode tersebut harus ada pada `tsi_so_item_sku_map`.
- Item Library master yang diacu adalah snapshot migrasi 026; untuk SKU resmi yang dibuat setelah snapshot, master harus diperbarui melalui proses terkontrol agar metrik selalu sesuai.
- Tidak dilakukan pengujian pada Supabase produksi; pengujian lokal tidak membuktikan angka toko sebenarnya.
