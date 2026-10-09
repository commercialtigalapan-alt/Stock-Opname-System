import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRuntime} from '../src/runtime.mjs';
const root=new URL('../',import.meta.url),b=fs.readFileSync(new URL('original/backend.gs',root),'utf8'),f=fs.readFileSync(new URL('original/index.html',root),'utf8');
new vm.Script(b);let scripts=0;for(const m of f.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){if(/type=["'](?:application\/json|text\/plain)/.test(m[1]))continue;new vm.Script(m[2],{filename:'frontend-script-'+ ++scripts})}
const r=createRuntime(undefined,{quiet:true,memory:true}),registry=r.evaluate('Object.keys(V13_RPC_ALLOWED)'),missing=registry.filter(n=>typeof r.ctx[n]!=='function');
const decls={};for(const m of b.matchAll(/(?:function\s+([A-Za-z_$][\w$]*)\s*\(|\b([A-Za-z_$][\w$]*)\s*=\s*function\s*\()/g)){const n=m[1]||m[2];decls[n]=(decls[n]||0)+1}
const apiNames=['SpreadsheetApp','DriveApp','DocumentApp','ScriptApp','Utilities','PropertiesService','CacheService','LockService','Session','UrlFetchApp','HtmlService'];
const services=Object.fromEntries(apiNames.map(n=>[n,[...new Set([...b.matchAll(new RegExp('\\b'+n+'\\.([A-Za-z_\\w]*)','g'))].map(m=>m[1]))].sort()]));
const frontCalls=[...new Set([...f.matchAll(/(?:rpc|run|v44RawRpc)\(\s*['"]([A-Za-z_$][\w$]*)['"]/g)].map(m=>m[1]))].sort();
const report={generatedAt:new Date().toISOString(),sourceHashes:{backend:crypto.createHash('sha256').update(b).digest('hex'),frontend:crypto.createHash('sha256').update(f).digest('hex')},lines:{backend:b.split('\n').length,frontend:f.split('\n').length},syntax:{backend:true,frontendScripts:scripts},functions:{active:Object.entries(r.ctx).filter(([k,v])=>typeof v==='function').length,registeredRpc:registry.length,sourceMissingRegisteredFunctions:r.sourceMissingRpc,missingRegisteredFunctions:missing,overwrittenDefinitions:Object.entries(decls).filter(([k,n])=>n>1).map(([name,count])=>({name,count}))},frontendRpc:frontCalls,unregisteredFrontendLiteralCalls:frontCalls.filter(n=>!registry.includes(n)),services,
 verificationLimits:['Static scan and local fixtures do not prove absence of bugs.','Supabase SQL has not been executed against the new project.','Old Google Drive files and real operational datasets have not been supplied.','Browser pixel comparison and real PDF rendering require Chromium.','Storage lifecycle paths that reference old Supabase native tables need separate verification.']};
fs.writeFileSync(new URL('docs/audit.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify({syntax:report.syntax,active:report.functions.active,registeredRpc:registry.length,missingFunctions:missing.length,frontendRpc:frontCalls.length,overwrites:report.functions.overwrittenDefinitions.length},null,2));
