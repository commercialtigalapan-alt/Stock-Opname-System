// Assemble a consistent snapshot using bounded pages instead of native_load's
// full-workbook jsonb aggregation. No partial snapshot is returned or cached.
export function makePagedLoader(call,decode,{pageRows=500,workers=4,progress=console.log,scope=()=>process.env.SUPABASE_URL+'\n'+process.env.SUPABASE_SECRET_KEY}={}){
  let cached=null,cacheScope=null;
  const rpc=(name,args={})=>call('/rest/v1/rpc/native_read_'+name,args);
  return {
    remember(state){cached=structuredClone(state);cacheScope=scope();},
    async load(){
      const tenant=scope();
      const head=await rpc('state');
      if(cached&&cacheScope===tenant&&cached.revision===head.revision)return structuredClone(cached);
      const manifest=await rpc('manifest');
      const state={revision:manifest.revision,properties:manifest.properties,files:manifest.files,triggers:manifest.triggers,sheets:{}};
      const tasks=[];let cursor=0,done=0;
      for(const [name,sheet] of Object.entries(manifest.sheets)){
        if(!Number.isSafeInteger(sheet.rowCount)||sheet.rowCount<0)throw Error('Jumlah baris tidak valid: '+name);
        state.sheets[name]={...sheet.meta,rows:new Array(sheet.rowCount)};
        for(let start=0;start<sheet.rowCount;start+=pageRows)tasks.push({name,start,count:Math.min(pageRows,sheet.rowCount-start)});
      }
      progress('Membaca '+Object.keys(state.sheets).length+' tab dalam '+tasks.length+' bagian kecil.');
      let failure;
      const worker=async()=>{
        while(!failure&&cursor<tasks.length){
          const task=tasks[cursor++];
          try{
            const data=await rpc('page',{p_revision:manifest.revision,p_name:task.name,p_start:task.start,p_limit:task.count});
            if(!Array.isArray(data.rows)||data.rows.length!==task.count)throw Error('Bagian data tidak lengkap: '+task.name);
            for(let i=0;i<data.rows.length;i++)state.sheets[task.name].rows[task.start+i]=data.rows[i];
            done++;if(done%25===0||done===tasks.length)progress('Pembacaan database: '+done+'/'+tasks.length+' bagian.');
          }catch(e){failure ||= e;}
        }
      };
      await Promise.all(Array.from({length:workers},worker));
      if(failure)throw failure;
      const end=await rpc('state');
      if(end.revision!==manifest.revision)throw Error('NATIVE_REVISION_CONFLICT: data berubah saat dibaca. Coba muat ulang.');
      const decoded=decode(state);cached=structuredClone(decoded);cacheScope=tenant;
      progress('Pembacaan selesai; revision '+state.revision+'.');return decoded;
    }
  };
}
