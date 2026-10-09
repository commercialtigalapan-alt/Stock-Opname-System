import http from 'node:http';
import fs from 'node:fs';
import {pathToFileURL} from 'node:url';
import {createRuntime} from './runtime.mjs';
import {load,commit} from './store.mjs';
import {runDue} from './scheduler.mjs';
process.env.TZ='Asia/Makassar';
process.env.SUPABASE_BUCKET||='so-files';
const root=new URL('../',import.meta.url);
const original=fs.readFileSync(new URL('original/index.html',root),'utf8');
const html=original.replace('<head>','<head>\n<script src="/native-transport.js"></script>').replace('</body>','<script src="/native-guards.js"></script>\n</body>');
const PUBLIC=new Set(['authV13','rpcV13','rpcBatchV104','heartbeatPresenceV6','processUploadJobV6']);
let tail=Promise.resolve();
export function serialize(fn){const next=tail.then(fn,fn);tail=next.catch(()=>{});return next}
const rates=new Map();
function rateLimit(key){const now=Date.now();for(const [k,v] of rates)if(v.until<now)rates.delete(k);const v=rates.get(key)||{n:0,until:now+600000};v.n++;rates.set(key,v);if(v.n>20)throw Object.assign(Error('Terlalu banyak percobaan login. Coba lagi dalam 10 menit.'),{status:429})}
const cookieToken=req=>{const v=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('so_session='));try{return v?decodeURIComponent(v.slice(11)):''}catch{return ''}};
function session(runtime,token){const s=runtime.call('v13GetSession_',[token]);if(!s?.user)throw Object.assign(Error('Session login berakhir. Silakan login kembali.'),{status:401});return s}
function cookie(token,ttl){return 'so_session='+encodeURIComponent(token)+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+Math.max(0,ttl)+(process.env.APP_ORIGIN?.startsWith('https://')?'; Secure':'')}
function send(res,status,body,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(typeof body==='string'?body:JSON.stringify(body))}
async function readBody(req){let n=0;const chunks=[],max=(Number(process.env.MAX_BODY_MB)||32)*1024*1024;for await(const c of req){n+=c.length;if(n>max)throw Object.assign(Error('Upload melebihi batas ukuran'),{status:413});chunks.push(c)}return JSON.parse(Buffer.concat(chunks).toString('utf8'))}
export async function dispatch(runtime,method,args=[],token=''){
 if(!PUBLIC.has(method))throw Object.assign(Error('Endpoint tidak diizinkan'),{status:403});
 if(method==='authV13'){
  const action=String(args[0]||'').toUpperCase();if(!['LOGIN','RESUME','LOGOUT','CHANGE_PASSWORD'].includes(action))throw Object.assign(Error('Action login tidak diizinkan'),{status:403});
  return runtime.call(method,args);
 }
 if(method==='rpcV13'){
  const t=args[2]||token;session(runtime,t);return runtime.call(method,[args[0],args[1]||[],t]);
 }
 const s=session(runtime,token);runtime.ctx.V13_AUTH_CONTEXT=s.user;
 try{
  if(method==='processUploadJobV6'&&s.user.ROLE==='VIEWER')throw Object.assign(Error('Viewer hanya dapat melihat data.'),{status:403});
  if(method==='rpcBatchV104'){
   const calls=args[0]||[];if(!Array.isArray(calls)||calls.length>30)throw Error('Batch tidak valid');
   for(const c of calls){if(!runtime.call('v126RpcAllowed_',[c?.name]))throw Error('RPC tidak diizinkan');if(s.user.ROLE==='VIEWER'&&!/^(get|list|search|find|preview|export|download|runSystemCheck)/.test(String(c?.name)))throw Object.assign(Error('Viewer hanya dapat melihat data.'),{status:403})}
  }
  return runtime.call(method,args);
 }finally{runtime.ctx.V13_AUTH_CONTEXT=null}
}
function canReadFile(r,id,user){
 const f=r.state.files[id];if(!f||f.trashed)return false;
 if(['SUPER_ADMIN','ADMIN_SO','MANAGEMENT'].includes(user.ROLE))return true;
 if(f.owner===user.USER_ID)return true;
 r.ctx.V13_AUTH_CONTEXT=user;
 try{for(const name of ['BA_LOG','BACKUP_LOG','SO_SIGNATURE']){
  const sh=r.book.getSheetByName(name);if(!sh)continue;
  for(const row of r.ctx.readTable_(name))if(['PDF_FILE_ID','DOC_FILE_ID','DRIVE_FILE_ID','SIGNATURE_FILE_ID'].some(k=>String(row[k]||'')===id)){
   let store=row.STORE_ID;if(!store&&row.SO_ID){const h=r.ctx.findOne_('SO_HEADER','SO_ID',row.SO_ID);store=h?.STORE_ID}
   if(store){try{r.call('requireStoreAccess_',[store]);return true}catch{}}
  }
 }return false}finally{r.ctx.V13_AUTH_CONTEXT=null}
}
function canReadFolder(r,id,user,seen=new Set()){
 const f=r.state.files[id];if(!f||f.trashed||seen.has(id))return false;seen.add(id);
 if(['SUPER_ADMIN','ADMIN_SO','MANAGEMENT'].includes(user.ROLE))return true;
 return Object.values(r.state.files).some(x=>x.parent===id&&!x.trashed&&(x.kind==='folder'?canReadFolder(r,x.id,user,seen):canReadFile(r,x.id,user)));
}
export function createServer({loadState=load,save=commit,memory=false}={}){
 return http.createServer(async(req,res)=>{
  try{
   const u=new URL(req.url,'http://localhost');
   if(req.method==='GET'&&u.pathname==='/')return send(res,200,html,{'Content-Type':'text/html; charset=utf-8','Referrer-Policy':'same-origin','Permissions-Policy':'camera=(self), microphone=()'});
   if(req.method==='GET'&&['/native-transport.js','/native-guards.js'].includes(u.pathname))return send(res,200,fs.readFileSync(new URL('public'+u.pathname,root),'utf8'),{'Content-Type':'text/javascript; charset=utf-8'});
   if(req.method==='GET'&&u.pathname==='/health')return send(res,200,{ok:true,service:'tigalapan-native'});
   if(req.method==='POST'&&u.pathname==='/api/rpc'){
    if(!req.headers.origin||req.headers.origin!==process.env.APP_ORIGIN)throw Object.assign(Error('Origin permintaan tidak diizinkan'),{status:403});
    const p=await readBody(req);if(!Array.isArray(p.args))throw Error('Args harus array');if(!PUBLIC.has(p.method))throw Object.assign(Error('Endpoint tidak diizinkan'),{status:403});
    if(p.method==='authV13'&&String(p.args[0]).toUpperCase()==='LOGIN')rateLimit(req.socket.remoteAddress+':'+String(p.args[1]?.username||'').toLowerCase());
    const result=await serialize(async()=>{
     const state=await loadState(),r=createRuntime(state,{origin:process.env.APP_ORIGIN,memory,timeout:Number(process.env.RPC_TIMEOUT_MS)||120000});
     r.files.actor=()=>r.ctx.V13_AUTH_CONTEXT;
     const d=await dispatch(r,p.method,p.args,cookieToken(req));
     if(!d||d.ok===false)return d;
     await r.files.upload();await save(r);return d;
    });
    const h={};if(p.method==='authV13'&&result?.ok){const token=result.data?.token||p.args[1]?.token;if(String(p.args[0]).toUpperCase()==='LOGOUT')h['Set-Cookie']=cookie('',0);else if(token)h['Set-Cookie']=cookie(token,Math.floor(((result.data?.expiresAt||Date.now()+21600000)-Date.now())/1000))}
    return send(res,200,result||{ok:false,error:'Respons server kosong'},h);
   }
   if(req.method==='GET'&&/^\/files\/[a-zA-Z0-9_-]+$/.test(u.pathname)){
    return await serialize(async()=>{
     const r=createRuntime(await loadState(),{origin:process.env.APP_ORIGIN,memory}),user=session(r,cookieToken(req)).user,id=u.pathname.split('/')[2];
     const f=r.state.files[id];if(!f||f.trashed)throw Object.assign(Error('File tidak ditemukan'),{status:404});
     if(f.kind==='folder'){
      const entries=Object.values(r.state.files).filter(x=>x.parent===id&&!x.trashed&&(x.kind==='folder'?canReadFolder(r,x.id,user):canReadFile(r,x.id,user)));const e=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
      if(!['SUPER_ADMIN','ADMIN_SO','MANAGEMENT'].includes(user.ROLE)&&!entries.length)throw Object.assign(Error('Akses arsip ditolak'),{status:403});
      return send(res,200,'<!doctype html><meta charset="utf-8"><title>Arsip Stock Opname</title><h1>Arsip Stock Opname</h1>'+entries.map(x=>'<p><a href="/files/'+x.id+'">'+e(x.name)+'</a></p>').join(''),{'Content-Type':'text/html; charset=utf-8'});
     }
     if(!canReadFile(r,id,user))throw Object.assign(Error('Akses file ditolak'),{status:403});
     const b=r.files.read(id);res.writeHead(200,{'Content-Type':b.type,'X-Content-Type-Options':'nosniff','Cache-Control':'no-store','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(f.name)});res.end(b.data);
    });
   }
   send(res,404,{ok:false,error:'Halaman tidak ditemukan'});
  }catch(e){console.error('native-request:',e.message);send(res,e.status||500,{ok:false,error:e.status?e.message:'Proses gagal. '+e.message})}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 if(!process.env.APP_AUTH_SECRET||process.env.APP_AUTH_SECRET.includes('CHANGE_ME'))throw Error('Isi APP_AUTH_SECRET sebelum menjalankan server');
 const port=Number(process.env.PORT)||3000;process.env.APP_ORIGIN||='http://localhost:'+port;
 createServer().listen(port,'0.0.0.0',()=>console.log('Stock Opname berjalan: '+process.env.APP_ORIGIN));
 if(process.env.SCHEDULER_ENABLED!=='false'){setInterval(()=>serialize(()=>runDue()).catch(e=>console.error('scheduler:',e.message)),60000).unref()}
}
