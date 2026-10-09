// Import lossless JSON snapshot, or a folder containing one UTF-8 CSV per tab.
// No Apps Script is needed for this step.
import fs from 'node:fs';
import path from 'node:path';
import {decode} from '../src/store.mjs';
import {createRuntime} from '../src/runtime.mjs';
import {seed} from '../src/seed.mjs';
import {parseCsv} from '../src/utilities.mjs';
import {runBatchedImport} from '../src/import-batches.mjs';
const input=process.argv[2];if(!input)throw Error('Pemakaian: npm run import -- /path/backup.json ATAU /path/folder-csv');
// Extended timeout applies only to this import process, including response reads.
process.env.DATA_API_TIMEOUT_MS ||= '600000';
if(!process.env.APP_AUTH_SECRET||process.env.APP_AUTH_SECRET==='CHANGE_ME_TO_A_RANDOM_SECRET'||process.env.APP_AUTH_SECRET.length<32)throw Error('Isi APP_AUTH_SECRET dengan kode acak privat pada .env sebelum impor.');
const started=Date.now();let phase='pemeriksaan koneksi';
const progress=message=>console.log('['+Math.round((Date.now()-started)/1000)+' detik] '+message);
const heartbeat=setInterval(()=>progress('Masih berjalan: '+phase),15000);heartbeat.unref();
progress('Menghubungkan ke Supabase; batas waktu per permintaan '+Math.round(Number(process.env.DATA_API_TIMEOUT_MS)/1000)+' detik.');
const state={revision:0,properties:{},files:{},triggers:[],sheets:{}};
progress('Menyiapkan data lokal; database tujuan diperiksa sebelum pengiriman.');phase='membaca dan menyiapkan data';
const r=createRuntime(state,{origin:process.env.APP_ORIGIN});
if(fs.statSync(input).isDirectory()){
 for(const n of fs.readdirSync(input).filter(x=>x.endsWith('.csv')).sort()){
  const rows=parseCsv(fs.readFileSync(path.join(input,n),'utf8'));if(!rows.length)continue;
  const h=rows[0];if(h.some(x=>!x)||new Set(h).size!==h.length)throw Error(n+': header kosong/duplikat');
  // Do not infer cell types: leading zero IDs and decimal strings must survive.
  // Date columns require ISO format to avoid ambiguous Indonesian vs US dates.
  rows.slice(1).forEach((row,ri)=>h.forEach((key,ci)=>{
   const v=row[ci];if(!v)return;
   if(/(?:_AT|_DATE)$/.test(key)&&key!=='LAST_SO_DATE'){
    if(/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(v)){const d=new Date(v.length===10?v+'T00:00:00+08:00':v);if(!isNaN(d))row[ci]=d}
    else throw Error(`${n} baris ${ri+2}, ${key}: ubah tanggal ke ISO yyyy-MM-dd atau yyyy-MM-ddTHH:mm:ss+08:00`);
   }
  }));
  const name=n.slice(0,-4),maxCols=Math.max(...rows.map(x=>x.length));rows.forEach(row=>{while(row.length<maxCols)row.push('')});r.state.sheets[name]={rows,maxRows:Math.max(1000,rows.length),maxCols};r.book.changed.add(name);
 }
}else{
 progress('Membaca file JSON '+(fs.statSync(input).size/1024/1024).toFixed(1)+' MiB.');
 const data=decode(JSON.parse(fs.readFileSync(input,'utf8')));if(!data.sheets||typeof data.sheets!=='object')throw Error('JSON harus memiliki objek sheets');
 for(const [name,x] of Object.entries(data.sheets)){if(!Array.isArray(x.rows))throw Error('rows tidak valid: '+name);r.state.sheets[name]=x;r.book.changed.add(name)}
}
progress('Data sumber terbaca: '+Object.keys(r.state.sheets).length+' tab. Menyiapkan konfigurasi aplikasi.');
seed(r);r.state.properties.V126_AUTH_SECRET=process.env.APP_AUTH_SECRET;
// Clear old file root configuration; old Drive IDs are not silently converted.
const cfg=r.ctx.findOne_('CONFIG','KEY','DRIVE_ROOT_FOLDER_ID');if(cfg)r.ctx.updateById_('CONFIG','KEY','DRIVE_ROOT_FOLDER_ID',{VALUE:'root'});
for(const handler of ['runReminderEngine','runAutoSchedulerV9','runStorageHousekeepingV107','runStorageLifecycleV123'])r.state.triggers.push({id:crypto.randomUUID(),handler,intervalMs:3600000,nextAt:Date.now()+3600000});
r.state.triggers.push({id:crypto.randomUUID(),handler:'runSoaDailyBackup',intervalMs:86400000,nextAt:Date.now()+86400000});
phase='menyiapkan file';progress('Menyiapkan file aplikasi.');await r.files.upload();
phase='mengirim dan menyimpan data';progress('Mengirim data ke Supabase. Jangan tutup terminal.');
try{await runBatchedImport(r,{progress});}catch(e){clearInterval(heartbeat);throw Error(e.message+'\nJangan jalankan init atau hapus data. Jika gangguan koneksi, jalankan perintah impor yang sama untuk melanjutkan.');}clearInterval(heartbeat);
progress('Import selesai: '+Object.keys(r.state.sheets).length+' tabel; revision '+r.state.revision+'. File arsip Google Drive perlu diimpor terpisah; lihat panduan.');
