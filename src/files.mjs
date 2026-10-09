import crypto from 'node:crypto';
import {Blob,syncHelper} from './utilities.mjs';
const iterator=a=>{let i=0;return {hasNext:()=>i<a.length,next:()=>{if(i>=a.length)throw Error('Iterator kosong');return a[i++]}}};
export class FileStore {
 constructor(state,{origin='http://localhost:3000',memory=false}={}){this.state=state;this.origin=origin;this.memory=memory;this.pending=new Map();state.files??={};state.files.root??={id:'root',name:'STOCK OPNAME',kind:'folder',parent:null,created:new Date().toISOString()}}
 get(id){if(!this.state.files[id])throw Error('File/folder tidak ditemukan: '+id);return this.state.files[id].kind==='folder'?new Folder(this,id):new File(this,id)}
 create(name,kind,parent='root',blob=null){const id=crypto.randomUUID();this.state.files[id]={id,name,kind,parent,owner:this.actor?.()?.USER_ID||'',created:new Date().toISOString(),updated:new Date().toISOString(),size:blob?.data.length||0,type:blob?.type||'application/octet-stream',path:id};if(blob)this.pending.set(id,blob);return this.get(id)}
 read(id){if(this.pending.has(id))return this.pending.get(id);const f=this.state.files[id];if(!f)throw Error('File tidak ada');if(f.inline)return new Blob(Buffer.from(f.inline,'base64'),f.type,f.name);if(this.memory)return new Blob('',f.type,f.name);const data=syncHelper('storage-read',{path:f.path});return new Blob(Buffer.from(data.data,'base64'),f.type,f.name)}
 async upload(){for(const [id,b] of this.pending){if(this.memory){this.state.files[id].inline=b.data.toString('base64');continue}const key=process.env.SUPABASE_SECRET_KEY,h={apikey:key,'Content-Type':b.type,'x-upsert':'true'};if(key.startsWith('eyJ'))h.Authorization='Bearer '+key;const r=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/'+process.env.SUPABASE_BUCKET+'/'+id,{method:'POST',headers:h,body:b.data,signal:AbortSignal.timeout(90000)});if(!r.ok)throw Error('Upload arsip HTTP '+r.status+': '+(await r.text()).slice(0,200));
  // Verify durable archive bytes before any corresponding hot-data deletion commits.
  if(b.type==='application/zip'){const check=await fetch(process.env.SUPABASE_URL+'/storage/v1/object/authenticated/'+process.env.SUPABASE_BUCKET+'/'+id,{headers:h,signal:AbortSignal.timeout(90000)});if(!check.ok)throw Error('Verifikasi arsip gagal HTTP '+check.status);const stored=Buffer.from(await check.arrayBuffer()),hash=x=>crypto.createHash('sha256').update(x).digest('hex');if(hash(stored)!==hash(b.data))throw Error('Checksum arsip tidak sesuai; perubahan database dibatalkan')}
 }}
}
class Entry {
 constructor(store,id){this.store=store;this.id=id} get meta(){return this.store.state.files[this.id]}
 getId(){return this.id} getName(){return this.meta.name} setName(n){this.meta.name=String(n);return this} getDateCreated(){return new Date(this.meta.created)} getLastUpdated(){return new Date(this.meta.updated)}
 getUrl(){return this.store.origin+'/files/'+this.id} getParents(){return iterator(this.meta.parent?[this.store.get(this.meta.parent)]:[])}
 setTrashed(v){this.meta.trashed=!!v;return this} isTrashed(){return !!this.meta.trashed} moveTo(f){this.meta.parent=f.id;return this}
}
export class Folder extends Entry {
 createFolder(n){return this.store.create(n,'folder',this.id)}
 getFoldersByName(n){return iterator(Object.values(this.store.state.files).filter(f=>f.parent===this.id&&f.kind==='folder'&&f.name===n&&!f.trashed).map(f=>this.store.get(f.id)))}
 getFolders(){return iterator(Object.values(this.store.state.files).filter(f=>f.parent===this.id&&f.kind==='folder'&&!f.trashed).map(f=>this.store.get(f.id)))}
 getFilesByName(n){return iterator(Object.values(this.store.state.files).filter(f=>f.parent===this.id&&f.kind!=='folder'&&f.name===n&&!f.trashed).map(f=>this.store.get(f.id)))}
 getFiles(){return iterator(Object.values(this.store.state.files).filter(f=>f.parent===this.id&&f.kind!=='folder'&&!f.trashed).map(f=>this.store.get(f.id)))}
 createFile(a,b,type){const blob=a instanceof Blob?a:new Blob(b,type||'text/plain',a);return this.store.create(blob.name,'file',this.id,blob)}
 addFile(f){f.meta.parent=this.id;return this} removeFile(f){if(f.meta.parent===this.id)f.meta.parent='root';return this}
}
export class File extends Entry {
 getSize(){return this.meta.size} getMimeType(){return this.meta.type} getBlob(){return this.store.read(this.id)}
 setContent(c){const b=new Blob(c,this.meta.type,this.meta.name);this.store.pending.set(this.id,b);this.meta.updated=new Date().toISOString();this.meta.size=b.data.length;return this}
 getAs(type){if(type==='application/pdf'&&this.meta.docHtml){const r=syncHelper('pdf',{html:this.meta.docHtml});return new Blob(Buffer.from(r.data,'base64'),type,this.meta.name+'.pdf')}return this.getBlob().getAs(type)}
 makeCopy(name,folder){return (folder||this.store.get(this.meta.parent||'root')).createFile(this.getBlob().copyBlob().setName(name||this.meta.name))}
}
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
class Element {
 constructor(tag,text='',parent=null){this.tag=tag;this.text=text;this.parent=parent;this.children=[];this.style={}}
 getParent(){return this.parent} getChild(i){return this.children[i]} getNumChildren(){return this.children.length}
 appendParagraph(s){const p=new Element('p',s,this);this.children.push(p);return p}
 appendTable(rows){const t=new Element('table','',this);t.children=rows.map(row=>{const tr=new Element('tr','',t);tr.children=row.map(s=>new Element('td',s,tr));return tr});this.children.push(t);return t}
 appendImage(blob){const im=new Element('img','',this);im.src='data:'+blob.type+';base64,'+blob.data.toString('base64');im.width=220;im.height=80;this.children.push(im);return im}
 appendInlineImage(b){return this.appendImage(b)} getCell(r,c){return c===undefined?this.children[r]:this.children[r].children[c]} getRow(r){return this.children[r]} getNumCells(){return this.children.length}
 getWidth(){return this.width||220} getHeight(){return this.height||80} setWidth(w){this.width=w;this.style.width=w+'px';return this} setHeight(h){this.height=h;this.style.height=h+'px';return this}
 setHeading(h){this.tag=h==='HEADING1'?'h1':h==='HEADING2'?'h2':'p';return this} setText(s){this.text=String(s);return this}
 setAlignment(a){this.style['text-align']=String(a).toLowerCase();return this} setVerticalAlignment(a){this.style['vertical-align']=String(a).toLowerCase();return this}
 setFontSize(n){this.style['font-size']=n+'pt';return this} setBold(v){this.style['font-weight']=v?'bold':'normal';return this}
 setPaddingTop(n){this.style['padding-top']=n+'pt';return this} setPaddingBottom(n){this.style['padding-bottom']=n+'pt';return this}
 setMinimumHeight(n){this.style.height=n+'pt';return this}
 setMarginTop(){return this} setMarginBottom(){return this} setMarginLeft(){return this} setMarginRight(){return this}
 getMarginLeft(){return 36} getMarginRight(){return 36} getPageWidth(){return 595}
 asParagraph(){return this} editAsText(){return this} getText(){return this.text}
 html(){const st=Object.entries(this.style).map(([k,v])=>k+':'+v).join(';');if(this.tag==='img')return `<img src="${this.src}" style="${st}" width="${this.width}" height="${this.height}"/>`;return `<${this.tag} style="${st}">${esc(this.text).replace(/\n/g,'<br>')}${this.children.map(x=>x.html()).join('')}</${this.tag}>`}
}
export function makeDocuments(files){return {ParagraphHeading:{HEADING1:'HEADING1',HEADING2:'HEADING2'},HorizontalAlignment:{CENTER:'CENTER',LEFT:'LEFT',RIGHT:'RIGHT'},VerticalAlignment:{CENTER:'MIDDLE',TOP:'TOP'},create:name=>{const file=files.create(name,'document'),body=new Element('div');return {getId:()=>file.id,getBody:()=>body,saveAndClose:()=>{file.meta.docHtml='<!doctype html><html><meta charset="utf-8"><style>body{font:10pt Arial;color:#111}h1{font-size:16pt}h2{font-size:12pt}table{border-collapse:collapse;width:100%;margin:8px 0;table-layout:fixed}td{border:1px solid #aaa;padding:5px;overflow-wrap:anywhere}tr{break-inside:avoid}img{object-fit:contain}p{margin:6px 0}</style>'+body.html()+'</html>';file.setContent(file.meta.docHtml);file.meta.type='text/html'}}}}}
