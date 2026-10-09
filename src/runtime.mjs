import fs from 'node:fs';
import vm from 'node:vm';
import {SheetBook,chain} from './sheets.mjs';
import {makeUtilities} from './utilities.mjs';
import {FileStore,makeDocuments} from './files.mjs';
import {readGoogleBook} from './google-sheets.mjs';
process.env.TZ='Asia/Makassar';
const source=fs.readFileSync(new URL('../original/backend.gs',import.meta.url),'utf8');
const compiled=new vm.Script(source,{filename:'original/backend.gs'});
const nativeOverrides=new vm.Script(`
// Database calls keep the same business semantics but are executed on the native snapshot.
soaMode_=function(){return 'SHEET'};soaOn_=function(){return false};
ss_=function(){return SpreadsheetApp.getActive()};
soaOpenById_=function(id){return SpreadsheetApp.openById(id)};soaActive_=ss_;
soaScriptLock_=function(){return LockService.getScriptLock()};soaFlush_=function(){};
v101Enabled_=function(){return false};v101MirrorEnabled_=function(){return false};v101ReadEnabled_=function(){return false};
soaCfg_=function(){return {url:'',key:'',pub:'',direct:false,tz:'Asia/Makassar',maxRows:15000,chunkRows:5000,smallRows:3000}};
getRootFolder_=function(){return DriveApp.getRootFolder()};
headers_=v31Headers_=function(name){var sh=sheet_(name);return sh.getRange(1,1,1,Math.max(1,sh.getLastColumn())).getValues()[0].map(String)};
// New databases learn fields from the unchanged business objects. Existing imported
// column order is retained; extensions are appended instead of dropping values.
function nativeEnsureFields_(name,fields){var sh=ss_().getSheetByName(name);if(!sh)throw new Error('Sheet '+name+' belum tersedia.');var h=sh.getLastColumn()?sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]:[];var add=fields.filter(function(k){return h.indexOf(k)<0});if(add.length){sh.getRange(1,h.length+1,1,add.length).setValues([add]);try{v32InvalidateBlockSheet_(name)}catch(e){}}}
var nativeAppendBase_=appendObject_,nativeAppendsBase_=appendObjects_,nativeUpdateBase_=updateById_;
appendObject_=function(name,obj){nativeEnsureFields_(name,Object.keys(obj));return nativeAppendBase_(name,obj)};
appendObjects_=function(name,objects){var fields=[];(objects||[]).forEach(function(o){Object.keys(o).forEach(function(k){if(fields.indexOf(k)<0)fields.push(k)})});if(fields.length)nativeEnsureFields_(name,fields);return nativeAppendsBase_(name,objects)};
updateById_=function(name,field,id,patch){nativeEnsureFields_(name,Object.keys(patch));return nativeUpdateBase_(name,field,id,patch)};
var nativeBaseBootstrap_=getAppBootstrapV6;
getAppBootstrapV6=function(){var r=nativeBaseBootstrap_.apply(this,arguments);if(r&&r.ok&&r.data){r.data.nativeServer=true;r.data.soaDirectRead=false;r.data.soa={enabled:false,direct:false,mode:'NATIVE'};r.data.supabaseDirect=null;r.data.directReadV106=false;r.data.directRead='NATIVE';}return r};
getAppBootstrapV2=function(){return getAppBootstrapV6()};
// V44 logout in the source only clears the client. Native logout also revokes
// the signed token, including across server restarts.
var nativeSessionBase_=v13GetSession_;
function nativeRevocations_(){var p=PropertiesService.getScriptProperties(),m={};try{m=JSON.parse(p.getProperty('NATIVE_REVOKED_TOKENS')||'{}')}catch(e){};Object.keys(m).forEach(function(k){if(Number(m[k])<Date.now())delete m[k]});return m}
function nativeTokenHash_(token){return v13Hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(token),Utilities.Charset.UTF_8))}
v13GetSession_=function(token){if(!token||nativeRevocations_()[nativeTokenHash_(token)])return null;return nativeSessionBase_(token)};
logoutV13=function(token){var s=nativeSessionBase_(token),m=nativeRevocations_();if(s)m[nativeTokenHash_(token)]=s.expiresAt;PropertiesService.getScriptProperties().setProperty('NATIVE_REVOKED_TOKENS',JSON.stringify(m));return result_({loggedOut:true})};
// The source registers 18 obsolete diagnostic names without implementations.
// These now report native runtime facts; they are not the unavailable old suites.
function nativeDiagnostics_(){requireRole_(['SUPER_ADMIN','ADMIN_SO']);var rows=ss_().getSheets().map(function(sh){return {name:sh.getName(),rows:Math.max(0,sh.getLastRow()-1),columns:sh.getLastColumn()}});return result_({runtime:'NODE_SUPABASE',mode:'NATIVE',enabled:true,legacyGoogleServices:false,sheets:rows,triggers:ScriptApp.getProjectTriggers().map(function(t){return t.getHandlerFunction()}),missingRpc:Object.keys(V13_RPC_ALLOWED).filter(function(n){return typeof globalThis[n]!=='function'}),scope:'Runtime/schema inventory only; not a full operational regression test',requiresLiveAcceptance:true})}
['runRegressionCheckV91','runRegressionCheckV97','runRegressionCheckV100','getSupabaseStatusV101','testSupabaseConnectionV101','runRegressionCheckV101','getSupabaseStatusV102','runRegressionCheckV102','getPerformanceDiagnosticsV103','runRegressionCheckV103','getPerformanceDiagnosticsV104','runRegressionCheckV104','getPerformanceDiagnosticsV105','runRegressionCheckV105','getPerformanceDiagnosticsV106','runRegressionCheckV106','getStorageLifecycleDiagnosticsV107','runRegressionCheckV107'].forEach(function(n){if(typeof globalThis[n]!=='function')globalThis[n]=nativeDiagnostics_});
// Hiding edit menus is not sufficient: VIEWER is read-only at the server boundary.
var nativeRpcBase_=rpcV13;
var nativeRequireRoleBase_=requireRole_,NATIVE_VIEWER_DASHBOARD_=false;
requireRole_=function(roles){var u=currentUser_(false);if(NATIVE_VIEWER_DASHBOARD_&&u.ROLE==='VIEWER')return u;return nativeRequireRoleBase_(roles)};
rpcV13=function(name,args,token){var s=v13GetSession_(token);if(!s||!s.user)return {ok:false,error:'Session login berakhir. Silakan login kembali.'};if(s.user.ROLE==='VIEWER'&&!/^(get|list|search|find|preview|export|download|runSystemCheck)/.test(String(name))&&['rpcBatchV104','markNotificationRead','markNotificationsReadBulkV14','notificationActionV9','heartbeatPresenceV6'].indexOf(name)<0)return {ok:false,error:'Viewer hanya dapat melihat data.'};NATIVE_VIEWER_DASHBOARD_=!!(s.user.ROLE==='VIEWER'&&/^getDashboard(?:V[0-9]+)?$/.test(String(name)));try{return nativeRpcBase_.apply(this,arguments)}finally{NATIVE_VIEWER_DASHBOARD_=false}};
rpcBatchV104=function(calls){try{var user=currentUser_(false);assert_(Array.isArray(calls)&&calls.length<=12,'Maksimal 12 read RPC per batch.');var items=calls.map(function(c){var n=String(c&&c.name||'');try{assert_(v126RpcAllowed_(n),'RPC tidak diizinkan');assert_(/^(get|list|find|preview|check|audit|search)/i.test(n),'Batch hanya untuk operasi baca');NATIVE_VIEWER_DASHBOARD_=user.ROLE==='VIEWER'&&/^getDashboard(?:V[0-9]+)?$/.test(n);var r=globalThis[n].apply(null,Array.isArray(c.args)?c.args:[]);return r&&r.ok===false?{name:n,ok:false,error:r.error}:{name:n,ok:true,data:r&&Object.prototype.hasOwnProperty.call(r,'data')?r.data:r}}catch(e){return {name:n,ok:false,error:String(e.message||e)}}finally{NATIVE_VIEWER_DASHBOARD_=false;V13_AUTH_CONTEXT=user}});return result_({items:items,version:APP_V104_VERSION})}catch(e){return fail_(e)}};
// Archive and retention now operate on the native tables/file catalogue, rather
// than querying the obsolete so_header/upload_job Supabase mirror schema.
runDriveArchiveWorkerV122=function(){var r=archiveReadySOsV11();if(r&&r.ok===false)return r;return result_({mode:'NATIVE_ARCHIVE',result:r&&r.data||r})};
function nativeArchiveRetention_(name,dateField,days){var all=readTable_(name),cut=Date.now()-days*86400000,old=all.filter(function(r){var d=new Date(r[dateField]);return isFinite(d.getTime())&&d.getTime()<cut});if(!old.length)return {table:name,archived:0};var f=ensureFolder_(getRootFolder_(),'SYSTEM ARCHIVE'),blob=Utilities.newBlob(v10ObjectsToCsv_(old),'text/csv',name+'.csv'),file=f.createFile(Utilities.zip([blob],name+'_'+fmtDate_(now_(),'yyyyMMdd_HHmmss')+'.zip'));assert_(file.getSize()>0,'Arsip kosong');appendObject_(APP.SHEETS.BACKUP_LOG,{BACKUP_ID:uuid_(),BACKUP_TYPE:'NATIVE_RETENTION',SOURCE_SHEET:name,DRIVE_FILE_ID:file.getId(),DRIVE_LINK:file.getUrl(),FILE_NAME:file.getName(),ROW_COUNT:old.length,FILE_SIZE:file.getSize(),STATUS:'ARCHIVED',CREATED_AT:now_(),CREATED_BY:activeUserEmail_()});overwriteTable_(name,all.filter(function(r){var d=new Date(r[dateField]);return !isFinite(d.getTime())||d.getTime()>=cut}));return {table:name,archived:old.length,url:file.getUrl()}}
runStorageLifecycleV123=function(){try{requireRole_(['SUPER_ADMIN','ADMIN_SO']);var so=runDriveArchiveWorkerV122();if(so&&so.ok===false)return so;var house=runStorageHousekeepingV107();if(house&&house.ok===false)return house;return result_({mode:'NATIVE_STORAGE',so:so.data,housekeeping:house&&house.data,systemLog:nativeArchiveRetention_('SYSTEM_LOG','TIMESTAMP',30),auditLog:nativeArchiveRetention_('AUDIT_LOG','TIMESTAMP',90)})}catch(e){return fail_(e)}};
getStorageLifecycleDiagnosticsV122=nativeDiagnostics_;getStorageLifecycleDiagnosticsV123=nativeDiagnostics_;
function nativeEncode_(v){if(v instanceof Date)return {$nativeDate:v.toISOString()};if(Array.isArray(v))return v.map(nativeEncode_);if(v&&typeof v==='object'){var out={};Object.keys(v).forEach(function(k){out[k]=nativeEncode_(v[k])});return out}return v}
soaBackupToDrive_=function(reason){var sheets={},count=0;ss_().getSheets().forEach(function(sh){sheets[sh.getName()]={rows:nativeEncode_(sh.getDataRange().getValues()),maxRows:sh.getMaxRows(),maxCols:sh.getMaxColumns()};count+=Math.max(0,sh.getLastRow()-1)});var json=JSON.stringify({format:'TSI_NATIVE_1',timeZone:'Asia/Makassar',sheets:sheets}),folder=ensureFolder_(getRootFolder_(),'SUPABASE BACKUP'),name='SUPABASE_DB_'+fmtDate_(now_(),'yyyyMMdd_HHmmss')+'.zip',file=folder.createFile(Utilities.zip([Utilities.newBlob(json,'application/json','snapshot.json')],name));var backups=[],it=folder.getFiles();while(it.hasNext()){var bf=it.next();if(/^SUPABASE_DB_.*\\.zip$/.test(bf.getName()))backups.push(bf)}backups.sort(function(a,b){return b.getDateCreated().getTime()-a.getDateCreated().getTime()});backups.slice(45).forEach(function(f){f.setTrashed(true)});appendObject_(APP.SHEETS.BACKUP_LOG,{BACKUP_ID:uuid_(),BACKUP_TYPE:'SUPABASE_DB_DAILY',DRIVE_FILE_ID:file.getId(),DRIVE_LINK:file.getUrl(),FILE_NAME:name,ROW_COUNT:count,FILE_SIZE:file.getSize(),STATUS:'ARCHIVED',CREATED_AT:now_(),CREATED_BY:'SYSTEM',NOTES:String(reason||'')});PropertiesService.getScriptProperties().setProperty('SOA_LAST_BACKUP_AT',now_().toISOString());return {fileName:name,url:file.getUrl(),bytes:file.getSize(),rows:count,sheets:Object.keys(sheets).length}};
runSoaDailyBackup=function(){var last=PropertiesService.getScriptProperties().getProperty('SOA_LAST_BACKUP_AT');if(last&&Date.now()-new Date(last).getTime()<20*3600000)return result_({skipped:'RECENT',last:last});try{return result_(soaBackupToDrive_('harian'))}catch(e){return fail_(e)}};
// Old installation endpoints are editor-only, never registered in the HTTP router.
`,{filename:'native-overrides.js'});
export const emptyState=()=>({revision:0,sheets:{},properties:{},files:{},triggers:[]});
export function createRuntime(state=emptyState(),options={}){
 state.properties??={};state.sheets??={};state.triggers??=[];
 const book=new SheetBook(state.sheets),files=new FileStore(state,options),cacheMap=options.cache||new Map();
 const externalBooks=new Map(),openBook=id=>{if(!id||String(id)==='native'||String(id)===state.properties.SPREADSHEET_ID||String(id)==='1C0JzD3pTRp_2k4qLecQYVDTagPOUnCKRlgsfl_xWhI0')return book;if(!externalBooks.has(id))externalBooks.set(id,(options.readGoogleBook||readGoogleBook)(id));return externalBooks.get(id)};
 const props={getProperty:k=>Object.hasOwn(state.properties,k)?state.properties[k]:null,getProperties:()=>({...state.properties}),setProperty:(k,v)=>{state.properties[k]=String(v);return props},setProperties:(a,del=false)=>{if(del)state.properties={};Object.assign(state.properties,Object.fromEntries(Object.entries(a).map(([k,v])=>[k,String(v)])));return props},deleteProperty:k=>{delete state.properties[k];return props},deleteAllProperties:()=>{state.properties={};return props}};
 const cache={get:k=>{const x=cacheMap.get(k);return x&&x.exp>Date.now()?x.value:null},put:(k,v,ttl=600)=>{cacheMap.set(k,{value:String(v),exp:Date.now()+ttl*1000})},remove:k=>cacheMap.delete(k),getAll:ks=>Object.fromEntries(ks.map(k=>[k,cache.get(k)]).filter(x=>x[1]!==null)),putAll:(a,t)=>Object.entries(a).forEach(([k,v])=>cache.put(k,v,t)),removeAll:ks=>ks.forEach(k=>cache.remove(k))};
 const trigger=t=>({getUniqueId:()=>t.id,getHandlerFunction:()=>t.handler,getEventType:()=> 'CLOCK'});
 const scriptApp={getScriptId:()=> 'native-stock-opname',getProjectTriggers:()=>state.triggers.map(trigger),deleteTrigger:t=>{state.triggers=state.triggers.filter(x=>x.id!==t.getUniqueId())},newTrigger:handler=>{const cfg={handler,intervalMs:3600000};const b={timeBased:()=>b,everyHours:n=>{cfg.intervalMs=n*3600000;return b},everyMinutes:n=>{cfg.intervalMs=n*60000;return b},everyDays:n=>{cfg.intervalMs=n*86400000;return b},after:n=>{cfg.intervalMs=n;cfg.once=true;return b},atHour:n=>{cfg.hour=n;return b},nearMinute:n=>{cfg.minute=n;return b},onWeekDay:d=>{cfg.day=d;return b},create:()=>{const t={...cfg,id:crypto.randomUUID(),nextAt:Date.now()+cfg.intervalMs};state.triggers.push(t);return trigger(t)}};return b},WeekDay:{MONDAY:1,TUESDAY:2,WEDNESDAY:3,THURSDAY:4,FRIDAY:5,SATURDAY:6,SUNDAY:0}};
 const lock={waitLock:()=>{},tryLock:()=>true,hasLock:()=>true,releaseLock:()=>{}};
 const ctx=vm.createContext({console:options.quiet?{log(){},warn(){},error(){}}:console,Date,JSON,Math,Number,String,Boolean,Array,Object,RegExp,Set,Map,Error,TypeError,RangeError,isFinite,isNaN,parseInt,parseFloat,Intl,Buffer,
  Utilities:makeUtilities(),PropertiesService:{getScriptProperties:()=>props},CacheService:{getScriptCache:()=>cache},LockService:{getScriptLock:()=>lock},
  Session:{getActiveUser:()=>({getEmail:()=>ctx.V13_AUTH_CONTEXT?.EMAIL||options.email||''}),getEffectiveUser:()=>({getEmail:()=>options.email||''}),getScriptTimeZone:()=> 'Asia/Makassar'},
  SpreadsheetApp:{openById:openBook,getActive:()=>book,flush:()=>{},newDataValidation:chain},ScriptApp:scriptApp,
  DriveApp:{getRootFolder:()=>files.get('root'),getFolderById:id=>files.get(String(id)),getFileById:id=>files.get(String(id)),createFile:(...a)=>files.get('root').createFile(...a)},DocumentApp:makeDocuments(files),
  MimeType:{PDF:'application/pdf',CSV:'text/csv',PLAIN_TEXT:'text/plain',ZIP:'application/zip',PNG:'image/png',GOOGLE_DOCS:'text/html'},Logger:{log:()=>{}},
  UrlFetchApp:{fetch:()=>{throw Error('Koneksi Apps Script lama dinonaktifkan; gunakan penyimpanan native')},fetchAll:()=>{throw Error('Koneksi Apps Script lama dinonaktifkan')}},
  HtmlService:{XFrameOptionsMode:{ALLOWALL:'ALLOWALL'},createTemplateFromFile:()=>{throw Error('Tampilan dilayani server native')},createHtmlOutputFromFile:()=>{throw Error('Tampilan dilayani server native')}}
 });
 compiled.runInContext(ctx,{timeout:10000});
 const sourceMissingRpc=Object.keys(ctx.V13_RPC_ALLOWED||{}).filter(n=>typeof ctx[n]!=='function');
 nativeOverrides.runInContext(ctx,{timeout:10000});
 // Properties in source have defaults for the previous project. Force standalone mode.
 ctx.PropertiesService.getScriptProperties().setProperty('SOA_DB_MODE','SHEET');
 const evaluate=code=>new vm.Script(code).runInContext(ctx,{timeout:options.timeout||120000});
 function call(name,args=[]){if(!/^[A-Za-z_$][\w$]*$/.test(name)||typeof ctx[name]!=='function')throw Error('Fungsi tidak tersedia: '+name);ctx.__nativeCallArgs=args;try{return evaluate(name+'.apply(null,__nativeCallArgs)')}finally{delete ctx.__nativeCallArgs}}
 return {state,book,files,ctx,call,evaluate,cache:cacheMap,sourceMissingRpc};
}
