import {createHash} from 'node:crypto';
import {api,encode} from './store.mjs';

const md5=s=>createHash('md5').update(s,'utf8').digest('hex');
export function prepareBatches(sheets,targetBytes=512*1024){
  const manifest={},parts=new Map();
  for(const [name,sheet] of Object.entries(sheets)){
    const chunks=[];let rows=[],bytes=2;
    const flush=()=>{const text='['+rows.join(',')+']';chunks.push({text,hash:md5(text),rows:rows.length});rows=[];bytes=2;};
    for(const row of sheet.rows){
      const text=JSON.stringify(encode(row)),size=Buffer.byteLength(text);
      if(rows.length&&bytes+size+1>targetBytes)flush();
      rows.push(text);bytes+=size+1;
    }
    if(rows.length)flush();
    manifest[name]={rows:sheet.rows.length,maxRows:sheet.maxRows,maxCols:sheet.maxCols,chunks:chunks.map(c=>({hash:c.hash,rows:c.rows}))};
    parts.set(name,chunks);
  }
  return {manifest,parts};
}

export async function runBatchedImport(runtime,{progress=console.log,call=api}={}){
  const {manifest,parts}=prepareBatches(runtime.state.sheets);
  // Dates, cell values and order are checksummed after the same preparation used by the old importer.
  const key=md5(JSON.stringify(manifest)+'\n'+process.env.APP_AUTH_SECRET);
  const rpc=(name,args)=>call('/rest/v1/rpc/native_import_'+name,args);
  const job=await rpc('begin',{p_key:key,p_manifest:manifest,p_properties:encode(runtime.state.properties),p_files:encode(runtime.state.files),p_triggers:encode(runtime.state.triggers)});
  if(job.status==='completed'){runtime.state.revision=job.revision;progress('Impor ini sudah lengkap di database; tidak ada data dikirim ulang.');return job;}
  progress('Database siap. Melanjutkan bagian yang belum lengkap.');
  for(const [name,chunks] of parts){
    if(job.ready.includes(name)){progress(name+': tab sudah lengkap.');continue;}
    const received=new Set(job.received[name]||[]);
    for(let i=0;i<chunks.length;i++){
      if(received.has(i))continue;
      await rpc('chunk',{p_job:job.id,p_name:name,p_index:i,p_text:chunks[i].text});
      progress(name+': bagian '+(i+1)+'/'+chunks.length+' tersimpan.');
    }
    await rpc('sheet',{p_job:job.id,p_name:name});progress(name+': tab lengkap.');
  }
  const result=await rpc('finish',{p_job:job.id});runtime.state.revision=result.revision;
  progress('Semua tab sudah diaktifkan dalam satu transaksi.');return result;
}
