// Local, synchronous cell interface. Persistence is handled atomically by store.mjs.
export class SheetBook {
  constructor(sheets={}, id='native', name='Stock Opname Tigalapan') {
    this.sheets=sheets; this.id=id; this.name=name; this.changed=new Set(); this.deleted=new Set();
  }
  getId(){return this.id} getName(){return this.name} getSpreadsheetTimeZone(){return 'Asia/Makassar'}
  getSheets(){return Object.keys(this.sheets).map(n=>new Sheet(this,n))}
  getSheetByName(n){return this.sheets[n]?new Sheet(this,n):null}
  insertSheet(n){if(this.sheets[n])throw Error('Sheet sudah ada: '+n);this.sheets[n]={rows:[],maxRows:1000,maxCols:26};this.changed.add(n);return new Sheet(this,n)}
  deleteSheet(sh){delete this.sheets[sh.name];this.changed.delete(sh.name);this.deleted.add(sh.name);return this}
  getActiveSheet(){return this.getSheets()[0]||null}
}
export class Sheet {
  constructor(book,name){this.book=book;this.name=name}
  get data(){return this.book.sheets[this.name]}
  touch(){this.book.changed.add(this.name);return this}
  getName(){return this.name} getSheetId(){return this.name} getParent(){return this.book}
  getLastRow(){const a=this.data.rows;for(let i=a.length-1;i>=0;i--)if(a[i]?.some(v=>v!==''&&v!=null))return i+1;return 0}
  getLastColumn(){return this.data.rows.reduce((m,r)=>{for(let i=r.length-1;i>=0;i--)if(r[i]!==''&&r[i]!=null)return Math.max(m,i+1);return m},0)}
  getMaxRows(){return Math.max(this.data.maxRows||1000,this.getLastRow())}
  getMaxColumns(){return Math.max(this.data.maxCols||26,this.getLastColumn())}
  getFrozenRows(){return this.data.frozenRows||0} getFrozenColumns(){return this.data.frozenCols||0}
  setFrozenRows(n){this.data.frozenRows=n;return this.touch()} setFrozenColumns(n){this.data.frozenCols=n;return this.touch()}
  insertRowsAfter(r,n){if(r<this.getLastRow())this.data.rows.splice(r,0,...Array.from({length:n},()=>[]));this.data.maxRows=this.getMaxRows()+n;return this.touch()}
  insertColumnsAfter(c,n){if(c<this.getLastColumn())this.data.rows.forEach(r=>r.splice(c,0,...Array(n).fill('')));this.data.maxCols=this.getMaxColumns()+n;return this.touch()}
  deleteRows(r,n=1){if(r<1||n<1)throw Error('Posisi hapus baris tidak valid');this.data.rows.splice(r-1,n);this.data.maxRows=Math.max(1,this.getMaxRows()-n);return this.touch()}
  deleteRow(r){return this.deleteRows(r)}
  appendRow(values){this.getRange(this.getLastRow()+1,1,1,values.length).setValues([values]);return this}
  clearContents(){this.data.rows=[];return this.touch()}
  getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()))}
  getRange(r,c,n=1,m=1){if(typeof r==='string'){const x=r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/i);if(!x)throw Error('A1 range tidak didukung: '+r);const col=s=>[...s.toUpperCase()].reduce((a,k)=>a*26+k.charCodeAt(0)-64,0);c=col(x[1]);r=+x[2];m=x[3]?col(x[3])-c+1:1;n=x[4]?+x[4]-r+1:1}return new Range(this,r,c,n,m)}
  createTextFinder(t){return this.getDataRange().createTextFinder(t)}
}
export class Range {
  constructor(sheet,row,col,n,m){for(const x of [row,col,n,m])if(!Number.isInteger(x)||x<1)throw Error('Range harus memakai bilangan bulat positif');Object.assign(this,{sheet,row,col,n,m})}
  getRow(){return this.row} getColumn(){return this.col} getNumRows(){return this.n} getNumColumns(){return this.m} getSheet(){return this.sheet}
  getA1Notation(){const col=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26)}return s};return col(this.col)+this.row+':'+col(this.col+this.m-1)+(this.row+this.n-1)}
  getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.m},(_,j)=>this.sheet.data.rows[this.row+i-1]?.[this.col+j-1]??''))}
  getDisplayValues(){return this.getValues().map(r=>r.map(v=>v instanceof Date?v.toISOString():String(v)))}
  getValue(){return this.getValues()[0][0]}
  getDisplayValue(){return this.getDisplayValues()[0][0]}
  setValues(a){if(a.length!==this.n||a.some(r=>r.length!==this.m))throw Error('Ukuran data tidak sama dengan range');for(let i=0;i<this.n;i++){const ri=this.row+i-1;this.sheet.data.rows[ri]??=[];for(let j=0;j<this.m;j++)this.sheet.data.rows[ri][this.col+j-1]=a[i][j]??''}this.sheet.touch();return this}
  setValue(v){return this.setValues(Array.from({length:this.n},()=>Array(this.m).fill(v)))}
  clearContent(){return this.setValue('')} clear(){return this.clearContent()}
  offset(r,c,n=this.n,m=this.m){return new Range(this.sheet,this.row+r,this.col+c,n,m)}
  getDataValidations(){return Array.from({length:this.n},()=>Array(this.m).fill(null))}
  createTextFinder(text){return new Finder(this,text)}
  sort(spec){const specs=Array.isArray(spec)?spec:[typeof spec==='number'?{column:spec}:spec];const a=this.getValues();a.sort((a,b)=>{for(const s of specs){const i=s.column-this.col,x=a[i],y=b[i],d=typeof x==='number'&&typeof y==='number'?x-y:String(x).localeCompare(String(y));if(d)return s.ascending===false?-d:d}return 0});return this.setValues(a)}
}
// Presentation-only Sheet methods do not change the web UI or stored values.
for(const k of ['setDataValidation','setDataValidations','clearDataValidations','setNumberFormat','setNumberFormats','setBackground','setFontWeight','setFontColor','setWrap','setHorizontalAlignment','setVerticalAlignment'])Range.prototype[k]=function(){return this};
export class Finder {
  constructor(range,text){this.range=range;this.text=String(text);this.entire=false;this.case=false;this.regex=false}
  matchEntireCell(v){this.entire=v;return this} matchCase(v){this.case=v;return this} useRegularExpression(v){this.regex=v;return this} matchFormulaText(){return this}
  findAll(){const out=[],needle=this.case?this.text:this.text.toLowerCase();this.range.getValues().forEach((r,i)=>r.forEach((v,j)=>{let s=String(v);if(!this.case)s=s.toLowerCase();const yes=this.regex?new RegExp(this.text,this.case?'':'i').test(String(v)):this.entire?s===needle:s.includes(needle);if(yes)out.push(new Range(this.range.sheet,this.range.row+i,this.range.col+j,1,1))}));return out}
  findNext(){return this.findAll()[0]||null}
}
export function chain(){const p=new Proxy({}, {get:(_,k)=>k==='build'?()=>({}):()=>p});return p}
