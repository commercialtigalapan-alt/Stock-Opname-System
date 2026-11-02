const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const base = path.resolve(__dirname,'..');
const sql = fs.readFileSync(path.join(base,'supabase/migrations/202611020030_cakupan_sku_resmi.sql'),'utf8');
const js = fs.readFileSync(path.join(base,'site/app.js'),'utf8');
const css = fs.readFileSync(path.join(base,'site/style.css'),'utf8');
assert.match(sql,/CREATE OR REPLACE FUNCTION public\.tsi_so_sku_coverage/i);
assert.match(sql,/tsi_so_authorize\(p_store,true\)/);
assert.match(sql,/tsi_so_item_sku_map/);
assert.match(sql,/m\.official_sku = upper\(btrim\(e\.sku\)\)/);
assert.match(sql,/'resmi',count\(\*\) FILTER \(WHERE b\.sku_official\)/);
assert.match(sql,/'belum_resmi',count\(\*\) FILTER \(WHERE NOT b\.sku_official\)/);
assert.match(sql,/FROM low LEFT JOIN base b ON true/,'Summary must also work for stores with empty inventory');
assert.match(sql,/'total_filtered',\(SELECT COUNT\(\*\) FROM filtered\)/);
assert.match(sql,/'items',COALESCE/);
assert.match(sql,/p_filter='RESMI' AND b\.sku_official/);
assert.match(sql,/p_filter='BELUM_RESMI' AND NOT b\.sku_official/);
assert.match(sql,/sku_official',sku_official/);
assert.doesNotMatch(sql,/\bDELETE\s+FROM\b|\bUPDATE\s+public\.tsi_so_inventory\b|\bTRUNCATE\b/i);
assert.match(css,/\.cov-official-stats/);
assert.match(js,/\['BELUM_RESMI','Belum resmi'\]/);
assert.match(js,/\['RESMI','SKU resmi'\]/);
const show = js.slice(js.indexOf('async function showCoverage(){'), js.indexOf("CHG['cov-store']"));
const ctx = {
 state:{cov:{store:'MAMU-MKS',filter:'ALL',search:'',offset:0},me:{role:'store',store_code:'MAMU-MKS'},stores:[{code:'MAMU-MKS',name:'MAMU Makassar'}]},
 rpc:async(name,params)=>{assert.equal(name,'sku_coverage');assert.equal(params.p_store,'MAMU-MKS');return {
  summary:{total:4,resmi:2,belum_resmi:2,sudah:1,belum:3,dipilih:3,terkunci:1,min_ratio:0},
  total_filtered:4,items:[
    {sku:'B01-108A02',name:'JET BLACK 24S MAMU PDK S',category:'24S MAMU',ratio:0,status:'BELUM',eligible:true,sku_official:true},
    {sku:'PENDING-000001',name:'ABU MISTY + RIB XL',category:'RIB',ratio:0,status:'BELUM',eligible:true,sku_official:false}
  ]
 }},
 isAdmin:()=>false,
 escapeHTML:s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
 n:v=>Number(v).toLocaleString('id-ID'),
 nameBadge:s=>String(s),
 chip:(s,l)=>l,
 btn:s=>s,
 rstHTML:()=>'',
 storeOptions:()=>'',
 labelStore:()=> 'MAMU Makassar',
 $:()=>ctx.content
};
ctx.content={innerHTML:''};
vm.createContext(ctx);
vm.runInContext(show+'\nshowCoverage()',ctx).then(()=>{
 const html=ctx.content.innerHTML;
 assert.match(html,/Sudah memiliki SKU resmi/);
 assert.match(html,/Belum memiliki SKU resmi/);
 assert.match(html,/>2<\/b>/);
 assert.match(html,/50% resmi/);
 assert.match(html,/PENDING-000001/);
 assert.match(html,/SKU Resmi<\/th>/);
 assert.match(html,/data-v="BELUM_RESMI"/);
 assert.match(html,/data-v="RESMI"/);
 assert.match(html,/Berdasarkan inventory aktif MAMU Makassar/);
 console.log('Cakupan SKU resmi tests: PASS (summary, filter, official+pending, percentage, authorization checks)');
}).catch(err=>{console.error(err);process.exitCode=1});
