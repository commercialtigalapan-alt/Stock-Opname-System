const fs=require('fs'),vm=require('vm'),assert=require('assert'),path=require('path');
const root=path.join(__dirname,'..');
const js=fs.readFileSync(path.join(root,'site/app.js'),'utf8');
const parse=js.match(/function parseCSV\(text\)\{[^]*?\n\}/)?.[0];
const norm=js.match(/function normHead\(s\)\{[^\n]+/)?.[0];
const imp=js.match(/function importRows\(csv\)\{[^]*?\n\}/)?.[0];
assert(parse&&norm&&imp,'CSV reader must exist');
function run(csv){return vm.runInNewContext(`${parse}\n${norm}\n${imp}\nimportRows(${JSON.stringify(csv)})`,{});}
const header='Name - Variant,Category,Ending,Cost,Harga Retail';
const dup=(a,b)=>[header,a,b].join('\n');
// Real Toraja example: source has extra spaces between STEEL and BLUE.
let rows=run(dup('KEMEJA FORMAL STEEL BLUE PDK 2XL,KEMEJA MAMU,0,0,199000','KEMEJA FORMAL STEEL  BLUE PDK 2XL,KEMEJA MAMU,0,0,199000'));
assert.equal(rows.length,1);assert.equal(rows[0].name,'KEMEJA FORMAL STEEL BLUE PDK 2XL');assert.equal(rows[0].ending,0);assert.equal(rows.deduplicated,1);
// A row with positive stock prevails over a zero duplicate; never add quantities.
rows=run(dup('SAMA ITEM,KAOS,0,40000,60000','SAMA  ITEM,KAOS,29,40000,60000'));
assert.equal(rows.length,1);assert.equal(rows[0].ending,29);assert.equal(rows.dedupeDetails[0].removedLine,2);
rows=run(dup('SAMA ITEM,KAOS,29,40000,60000','SAMA  ITEM,KAOS,0,40000,60000'));
assert.equal(rows.length,1);assert.equal(rows[0].ending,29);
// Two positive rows must never be silently summed or dropped.
assert.throws(()=>run(dup('SAMA ITEM,KAOS,29,40000,60000','SAMA ITEM,KAOS,7,40000,60000')),e=>e.conflicts?.[0]?.reason==='Kedua baris memiliki stok positif');
// Different category or prices are material, even if both quantities are zero.
assert.throws(()=>run(dup('SAMA ITEM,KAOS,0,40000,60000','SAMA ITEM,KEMEJA,0,40000,60000')),e=>e.conflicts?.[0]?.reason==='Kategori/HPP/Harga berbeda');
assert.throws(()=>run(dup('SAMA ITEM,KAOS,0,40000,60000','SAMA ITEM,KAOS,0,40000,65000')),e=>Array.isArray(e.conflicts));
// All unsafe duplicates surfaced at once, not just the first.
let conflictCsv=[header,'A,KAOS,1,0,0','A,KAOS,2,0,0','B,KAOS,3,0,0','B,KAOS,4,0,0'].join('\n');
assert.throws(()=>run(conflictCsv),e=>e.conflicts?.length===2);
// All 10 Toraja variants from previous diagnostic should retain exactly one name.
const sizes=['S','M','L','XL','2XL'];const multi=[header];
for(const arm of ['PDK','PJG'])for(const size of sizes){multi.push(`KEMEJA FORMAL STEEL BLUE ${arm} ${size},KEMEJA MAMU,0,0,199000`);multi.push(`KEMEJA FORMAL STEEL  BLUE ${arm} ${size},KEMEJA MAMU,0,0,199000`)}
rows=run(multi.join('\n'));
assert.equal(rows.length,10);assert.equal(rows.deduplicated,10);
assert(js.includes("ACT['up-conflicts-csv']"));
assert(js.includes('duplikat aman dirapikan'));
const index=fs.readFileSync(path.join(root,'site/index.html'),'utf8');
assert(index.includes('20261102-upload-dedupe-v036'));
console.log('Upload duplicate normalization v36: PASS (0-value duplicates, nonzero preservation, metadata conflicts, full Toraja sample)');
