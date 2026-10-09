import crypto from 'node:crypto';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const signed=b=>Array.from(b,x=>x>127?x-256:x);
export const bytes=v=>Buffer.isBuffer(v)?v:Array.isArray(v)?Buffer.from(v.map(x=>(Number(x)+256)%256)):Buffer.from(String(v),'utf8');
export class Blob {
 constructor(data,type='application/octet-stream',name='file'){this.data=bytes(data);this.type=type;this.name=name}
 getBytes(){return signed(this.data)} getDataAsString(enc='UTF-8'){return this.data.toString(enc.toLowerCase().replace('-',''))}
 getContentType(){return this.type} getName(){return this.name} setName(n){this.name=n;return this} setContentType(t){this.type=t;return this}
 getAs(t){if(t===this.type)return this;throw Error('Konversi blob belum didukung: '+t)} copyBlob(){return new Blob(this.data,this.type,this.name)}
}
export function syncHelper(action,data){const r=spawnSync(process.execPath,[fileURLToPath(new URL('./helper.mjs',import.meta.url)),action],{input:JSON.stringify(data),encoding:'utf8',maxBuffer:160*1024*1024,timeout:90000,env:process.env});if(r.status!==0)throw Error('Proses '+action+' gagal: '+String(r.stderr||r.error||'').slice(0,700));return JSON.parse(r.stdout)}
export function parseCsv(s,delimiter=','){const rows=[],row=[];let cell='',quoted=false;s=String(s).replace(/^\uFEFF/,'');for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++}else quoted=!quoted}else if(c===delimiter&&!quoted){row.push(cell);cell=''}else if((c==='\r'||c==='\n')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);rows.push(row.splice(0));cell=''}else cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}return rows}
export function formatDate(d,tz,format){if(!(d instanceof Date)||!Number.isFinite(d.getTime()))throw Error('Tanggal tidak valid');const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(d).map(x=>[x.type,x.value]));const names=new Intl.DateTimeFormat('en-GB',{timeZone:tz,month:'long'}).format(d),weekday=new Intl.DateTimeFormat('en-GB',{timeZone:tz,weekday:'long'}).format(d);const v={yyyy:parts.year,yy:parts.year.slice(-2),MMMM:names,MMM:names.slice(0,3),MM:parts.month,M:String(+parts.month),dd:parts.day,d:String(+parts.day),HH:parts.hour,H:String(+parts.hour),mm:parts.minute,ss:parts.second,EEEE:weekday,EEE:weekday.slice(0,3)};return String(format).replace(/'([^']*)'|yyyy|MMMM|EEEE|MMM|EEE|yy|MM|dd|HH|mm|ss|M|d|H/g,(t,l)=>l??v[t])}
export function parseDate(s,tz,format){s=String(s);let y,mo,d,h=0,mi=0,se=0;const names={yyyy:'y',MM:'mo',M:'mo',dd:'d',d:'d',HH:'h',mm:'mi',ss:'se'},keys=[];const pattern=String(format).replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/yyyy|MM|dd|HH|mm|ss|M|d/g,t=>{keys.push(names[t]);return '(\\d{1,4})'});const m=s.match(new RegExp('^'+pattern+'$'));if(!m)throw Error('Tanggal tidak sesuai format '+format);const v={};keys.forEach((k,i)=>v[k]=+m[i+1]);({y,mo,d,h=0,mi=0,se=0}=v);let utc=Date.UTC(y,mo-1,d,h,mi,se);const rendered=formatDate(new Date(utc),tz,'yyyy-MM-dd HH:mm:ss');const local=Date.parse(rendered.replace(' ','T')+'Z');utc-=local-utc;const dt=new Date(utc);if(formatDate(dt,tz,format)!==s&&format==='yyyy-MM-dd HH:mm:ss')throw Error('Tanggal tidak valid');return dt}
export function makeUtilities(){return {
 Charset:{UTF_8:'utf8'},DigestAlgorithm:{SHA_256:'sha256',SHA_1:'sha1',MD5:'md5'},
 getUuid:()=>crypto.randomUUID(),computeDigest:(a,v)=>signed(crypto.createHash(a).update(bytes(v)).digest()),computeHmacSha256Signature:(v,key)=>signed(crypto.createHmac('sha256',bytes(key)).update(bytes(v)).digest()),
 base64Encode:v=>bytes(v).toString('base64'),base64EncodeWebSafe:v=>bytes(v).toString('base64url'),base64Decode:s=>signed(Buffer.from(s,'base64')),base64DecodeWebSafe:s=>signed(Buffer.from(s,'base64url')),
 newBlob:(d,t,n)=>new Blob(d,t,n),parseCsv,formatDate,parseDate,
 gzip:(b,n)=>new Blob(zlib.gzipSync(b.data),'application/gzip',n||b.name+'.gz'),ungzip:b=>new Blob(zlib.gunzipSync(b.data),'application/octet-stream',b.name.replace(/\.gz$/,'')),
 zip:(blobs,name)=>{const r=syncHelper('zip',{files:blobs.map(b=>({name:b.name,data:b.data.toString('base64')}))});return new Blob(Buffer.from(r.data,'base64'),'application/zip',name||'archive.zip')},
 unzip:b=>syncHelper('unzip',{data:b.data.toString('base64')}).files.map(f=>new Blob(Buffer.from(f.data,'base64'),'application/octet-stream',f.name)),
 sleep:ms=>{if(ms>10000)throw Error('Sleep terlalu lama pada server mandiri');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}
}}
