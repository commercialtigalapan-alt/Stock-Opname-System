const keyHeaders=()=>{const k=process.env.SUPABASE_SECRET_KEY;if(!k)throw Error('SUPABASE_SECRET_KEY belum diisi');const h={apikey:k,'Content-Type':'application/json'};if(k.startsWith('eyJ'))h.Authorization='Bearer '+k;return h};
export async function api(path,body,method=body===undefined?'GET':'POST',extra={}){
  const url=process.env.SUPABASE_URL;if(!url||!/https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url))throw Error('SUPABASE_URL belum valid');
  const timeoutMs=Number(process.env.DATA_API_TIMEOUT_MS||90000);
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>1800000)throw Error('DATA_API_TIMEOUT_MS harus 1000–1800000 ms');
  const signal=AbortSignal.timeout(timeoutMs);
  let r,t;
  try{
    r=await fetch(url+path,{method,headers:{...keyHeaders(),...extra},body:body===undefined?undefined:JSON.stringify(body),signal});
    t=await r.text();
  }catch(e){
    if(signal.aborted)throw Error('Database timeout '+Math.round(timeoutMs/1000)+' detik pada '+path+(path.endsWith('/native_commit')?'. Respons simpan belum diketahui; muat ulang data sebelum mencoba kembali.':'. Pembacaan data belum selesai; tidak perlu mengulang impor.'));
    throw Error('Koneksi database gagal pada '+path+': '+(e.cause?.code||e.name));
  }
  if(!r.ok)throw Error('Database HTTP '+r.status+': '+t.slice(0,500));return t?JSON.parse(t):null;
}
import {makePagedLoader} from './paged-load.mjs';
const pagedLoader=makePagedLoader(api,decode);
export async function load(){return pagedLoader.load()}

export function encode(v){if(v instanceof Date)return {$nativeDate:v.toISOString()};if(Array.isArray(v))return v.map(encode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]));return v}
export function decode(v){if(v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.$nativeDate==='string'&&Object.keys(v).length===1)return new Date(v.$nativeDate);if(Array.isArray(v))return v.map(decode);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,decode(x)]));return v}
export async function commit(runtime){const {state,book}=runtime;const sheets=Object.fromEntries([...book.changed].map(n=>[n,encode(state.sheets[n])]));
  const r=await api('/rest/v1/rpc/native_commit',{p_revision:state.revision,p_sheets:sheets,p_deleted:[...book.deleted],p_properties:state.properties,p_files:state.files,p_triggers:state.triggers,p_request_id:crypto.randomUUID()});state.revision=r.revision;pagedLoader.remember(state);return r;
}
