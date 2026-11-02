// Lightweight rendering checks for BA detail, printing, HTML export & XSS escaping.
const fs=require('fs');
const vm=require('vm');
const assert=require('assert');
const path=require('path');
const js=fs.readFileSync(path.join(__dirname,'../site/app.js'),'utf8');
const start=js.indexOf('function baArticle(');
const stop=js.indexOf('async function loadBADetail()',start);
assert(start>=0&&stop>start);
const source=`const escapeHTML=v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));\n`+
 `const fmtDT=t=>t||'—';const n=v=>String(v||0);const signed=v=>String(v);const rp=v=>'Rp '+v;\n`+js.slice(start,stop)+'\nthis.baArticle=baArticle;';
const context={};vm.runInNewContext(source,context);
const h={id:'ba-1',ba_no:'BA/TEST/001',store_code:'TPK-MKS',store_name:'Makassar',started_at:'2026-11-02',created_at:'2026-11-02',created_name:'Admin'};
const s={total_skus:2,tally_count:0,variance_count:2,net_qty:-2,missing_value:10000,surplus_value:4000};
const lines=[
 {sku:'SKU-1',item_name:'Kaos Hitam L',system_qty:5,actual_qty:3,diff_qty:-2,unit_cost:5000,reason:'Picking salah <3 pcs>'},
 {sku:'SKU-2',item_name:'Kaos Putih M',system_qty:4,actual_qty:6,diff_qty:2,unit_cost:2000,reason:'Retur belum tercatat'}
];
const printable=context.baArticle(h,s,lines,2,true);
assert(printable.includes('<th>Alasan</th>'));
assert(printable.includes('Picking salah &lt;3 pcs&gt;'));
assert(printable.includes('Retur belum tercatat'));
assert(!printable.includes('data-change="ba-reason"'));
const draft=context.baArticle(h,s,lines,2,false,true);
assert.equal((draft.match(/data-change="ba-reason"/g)||[]).length,2);
assert(draft.includes('data-sku="SKU-1"'));
assert(draft.includes('ba-reason-print'));
const signed=context.baArticle(h,s,lines,2,false,false);
assert(!signed.includes('<textarea'));
const sql=fs.readFileSync(path.join(__dirname,'../supabase/migrations/202610280025_ba_alasan_per_sku.sql'),'utf8');
assert(sql.includes('reason_overrides'));
assert(sql.includes('BA_REASON_EDIT'));
assert.equal((sql.match(/as reason/g)||[]).length,2);
assert(sql.includes('reason_overrides = \'{}\'::jsonb'));
console.log('BA reason tests: PASS (per SKU, HTML export, edit-only draft, escaping, SQL integration)');
