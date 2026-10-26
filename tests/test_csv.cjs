const fs=require('fs');const vm=require('vm');const assert=require('assert');
const src=fs.readFileSync(__dirname+'/../site/app.js','utf8');
const funcs=src.slice(src.indexOf('function parseCSV('),src.indexOf('function showUpload('));
const context={};vm.createContext(context);vm.runInContext(funcs,context);
const {parseCSV,importRows}=context;
function same(actual,expected){assert.strictEqual(JSON.stringify(actual),JSON.stringify(expected));}
let rows=importRows('SKU,NAME_VARIANT,CATEGORY,ENDING,COST\nSKU-1,"Kaos, Navy",Kaos,2,10000\nSKU-2,Hitam,Kaos,0,1000');
assert.equal(rows.length,2);assert.equal(rows[0].name,'Kaos, Navy');assert.equal(rows[1].ending,0);
rows=importRows('SKU;NAME_VARIANT;ENDING\nA1;Hitam;0\nB2;Putih;7');assert.equal(rows.length,2);assert.equal(rows[0].cost,0);
assert.throws(()=>importRows('SKU,NAME_VARIANT,ENDING\nA,A,2\nA,B,3'),/duplikat/);
assert.throws(()=>importRows('SKU,NAME_VARIANT,ENDING\nA,A,-1'),/tidak valid/);
console.log('CSV parser tests: PASS (quoted field, semicolon, zero, duplicate, invalid qty)');
