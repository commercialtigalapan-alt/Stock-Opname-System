import {load,commit} from './store.mjs';
import {createRuntime} from './runtime.mjs';
const ALLOWED=new Set(['runReminderEngine','runAutoSchedulerV9','runAutoSchedulerV10','runAutoSchedulerV12','archiveReadySOsV11','runStorageHousekeepingV107','runStorageLifecycleV123','runDriveArchiveWorkerV122','runSoaDailyBackup']);
export async function runDue(){const state=await load(),now=Date.now();const due=state.triggers.filter(t=>t.nextAt<=now);if(!due.length)return {processed:0};const r=createRuntime(state,{origin:process.env.APP_ORIGIN});const user=r.ctx.readTable_('USERS').find(u=>u.ROLE==='SUPER_ADMIN'&&u.STATUS==='ACTIVE');if(!user)throw Error('Scheduler memerlukan Super Admin aktif');r.ctx.V13_AUTH_CONTEXT=user;r.files.actor=()=>user;const results=[];
 for(const t of due){if(!ALLOWED.has(t.handler)){results.push({handler:t.handler,error:'Trigger lama memerlukan pemetaan native'});t.nextAt=now+3600000;continue}
  try{const d=r.call(t.handler,[]);if(d?.ok===false)throw Error(d.error);t.nextAt=now+(t.intervalMs||3600000);results.push({handler:t.handler,ok:true})}catch(e){
   // Abort the entire batch; never publish partial counting/archive writes.
   throw Error('Trigger '+t.handler+' gagal: '+e.message);
  }
 }
 r.state.triggers=r.state.triggers.filter(t=>!t.once||!due.some(d=>d.id===t.id));await r.files.upload();await commit(r);return {processed:results.length,results};
}
