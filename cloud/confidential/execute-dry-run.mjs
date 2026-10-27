// A live drill writes only the explicitly named, blank synthetic target.
import {randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function executeDryRun({command,status,persist,sourceRef,targetRef,vault,mode,scope,allowOverwrite=false,dropboxCapsuleId,vaultProvider}) {
 if(status.executing)throw new Error('drill_already_running');
 status.executing=true;status.state='checking_target';await persist();
 try {
  const effectiveMode = mode || vault || 'temporary_runner';
  const check=await command('preflight', { mode: effectiveMode, allowOverwrite: Boolean(allowOverwrite) });
  async function wait(job,kind){
   const deadline=Date.now()+90*60000;
   do {
    const current=await command('job.status',{id:job.id});
    status[kind]=current;await persist();
    if(current.state==='complete')return current;
    if(current.state==='failed')throw new Error(current.error||'drill_job_failed');
    if(Date.now()>deadline)throw new Error('drill_wait_timeout');
    await sleep(4000);
   }while(true);
  }
  if (effectiveMode === 'capsule_only') {
   if (check.source?.ref !== sourceRef || (!check.ready && !allowOverwrite)) throw new Error('unsafe_test_selection');
   status.state = 'capturing';
   const backup = await command('backup.start', { requestId: randomUUID(), vault: 'dropbox', scope, allowOverwrite: Boolean(allowOverwrite) });
   status.backupExecuted = true;
   const captured = await wait(backup, 'backup');
   if (!captured.result?.captureComplete) throw new Error('capture_not_complete');
   if (captured.result?.destinationKind !== 'dropbox' || captured.result?.vaultVerified !== true) throw new Error('dropbox_delivery_unverified');
   status.state = 'capsule_delivered';
   return;
  }
  if (effectiveMode === 'restore_only') {
   if (check.target?.ref !== targetRef || (!check.target?.blank && !allowOverwrite) || (!check.ready && !allowOverwrite)) throw new Error('unsafe_test_selection');
   const chosenCapsuleId = dropboxCapsuleId || status.backup?.id || status.backup?.result?.capsuleId;
   if (!chosenCapsuleId) throw new Error('capsule_not_available');
   status.state = 'restoring'; await persist();
   const restore = await command('restore.start', {
    requestId: randomUUID(),
    capsuleId: chosenCapsuleId,
    dropboxCapsuleId: dropboxCapsuleId || status.backup?.result?.capsuleId,
    confirmTarget: targetRef,
    acknowledgeManualConfig: true,
    allowOverwrite: Boolean(allowOverwrite),
   });
   status.restoreExecuted = true;
   const restored = await wait(restore, 'restore');
   if (!restored.result?.restoreVerified) throw new Error('restore_not_verified');
   status.state = 'recovery_data_path_verified';
   return;
  }
  if(check.source?.ref!==sourceRef||check.target?.ref!==targetRef||(!check.target?.blank&&!allowOverwrite)||(!check.ready&&!allowOverwrite))throw new Error('unsafe_test_selection');
  status.state='capturing';
  const backup=await command('backup.start',{requestId:randomUUID(),vault:effectiveMode,scope,allowOverwrite:Boolean(allowOverwrite)});
  status.backupExecuted=true;
  const captured=await wait(backup,'backup');
  if(!captured.result?.captureComplete)throw new Error('capture_not_complete');
  if(effectiveMode==='dropbox' && (captured.result?.destinationKind!=='dropbox'||captured.result?.vaultVerified!==true))throw new Error('dropbox_delivery_unverified');
  status.state='restoring';await persist();
  const restore=await command('restore.start',{requestId:randomUUID(),capsuleId:backup.id,confirmTarget:targetRef,acknowledgeManualConfig:true,allowOverwrite:Boolean(allowOverwrite)});
  status.restoreExecuted=true;
  const restored=await wait(restore,'restore');
  if(!restored.result?.restoreVerified)throw new Error('restore_not_verified');
  status.state='recovery_data_path_verified';
 }catch(e){status.state='drill_failed';status.error=/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'drill_failed';}
 finally{status.executing=false;await persist();}
}
