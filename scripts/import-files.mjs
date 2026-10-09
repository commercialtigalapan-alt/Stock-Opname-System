// Preserve old IDs so signature/BA/archive references keep working.
// Input: [{id,name,kind:"file"|"folder",parent,path,type,storeId?}]
import fs from 'node:fs';
import path from 'node:path';
import {load,commit} from '../src/store.mjs';
import {createRuntime} from '../src/runtime.mjs';
import {Blob} from '../src/utilities.mjs';
const manifest=process.argv[2];if(!manifest)throw Error('Gunakan: node --env-file=.env scripts/import-files.mjs manifest.json');
const list=JSON.parse(fs.readFileSync(manifest,'utf8'));if(!Array.isArray(list))throw Error('Manifest harus array');
const ids=new Set();for(const x of list){if(!/^[a-zA-Z0-9_-]+$/.test(x.id)||ids.has(x.id)||x.id==='root')throw Error('ID file tidak valid/duplikat: '+x.id);ids.add(x.id)}
const r=createRuntime(await load(),{origin:process.env.APP_ORIGIN});
for(const x of list){if(r.state.files[x.id])throw Error('File sudah diimpor: '+x.id);const kind=x.kind||'file';const b=kind==='folder'?null:new Blob(fs.readFileSync(path.resolve(path.dirname(manifest),x.path)),x.type||'application/octet-stream',x.name);r.state.files[x.id]={id:x.id,name:x.name,kind,parent:x.parent||'root',created:new Date().toISOString(),updated:new Date().toISOString(),path:x.id,type:b?.type||'',size:b?.data.length||0};if(b)r.files.pending.set(x.id,b)}
for(const f of Object.values(r.state.files))if(f.parent&&!r.state.files[f.parent])throw Error('Folder induk belum tersedia: '+f.parent);
for(const f of Object.values(r.state.files)){const seen=new Set();let p=f;while(p){if(seen.has(p.id))throw Error('Folder membentuk siklus: '+f.id);seen.add(p.id);p=p.parent?r.state.files[p.parent]:null}}
for(const [name,p] of Object.entries(r.state.sheets)){
 const h=p.rows[0]||[];const cols=h.map((k,i)=>/LINK|URL/.test(k)?i:-1).filter(i=>i>=0);let changed=false;
 for(const row of p.rows.slice(1))for(const i of cols){const v=String(row[i]||'');if(!/drive\.google\.com|docs\.google\.com/.test(v))continue;const id=list.find(x=>v.includes(x.id))?.id;if(id){row[i]=process.env.APP_ORIGIN+'/files/'+id;changed=true}}
 if(changed)r.book.changed.add(name);
}
await r.files.upload();await commit(r);console.log('File diimpor:',list.length);
