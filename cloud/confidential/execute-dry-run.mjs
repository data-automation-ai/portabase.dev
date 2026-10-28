// A live drill writes only the explicitly named, blank synthetic target.
import {randomUUID} from 'node:crypto';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function executeDryRun({command,status,persist,sourceRef,targetRef,vault,mode,scope,allowOverwrite=false,dropboxCapsuleId,vaultProvider,sourceRefs,targetMap}) {
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

  // Multi-Project Batch Execution (Sequential batch capture + 1-to-1 restore)
  if (Array.isArray(sourceRefs) && sourceRefs.length > 1) {
   status.batchProgress = { currentIndex: 0, total: sourceRefs.length, completedCapsules: [] };
   for (let i = 0; i < sourceRefs.length; i++) {
    const curSource = sourceRefs[i];
    const curTarget = targetMap?.[curSource] || targetRef;
    status.batchProgress.currentIndex = i + 1;
    status.batchProgress.currentRef = curSource;
    await command('project.select', { slot: 'source', ref: curSource });
    if (effectiveMode !== 'capsule_only' && curTarget) {
     await command('project.select', { slot: 'target', ref: curTarget });
    }
    status.state = 'capturing'; await persist();
    const targetVault = effectiveMode === 'temporary_runner' ? 'temporary_runner' : (vaultProvider || status.activeVault || 'dropbox');
    const backup = await command('backup.start', { requestId: randomUUID(), vault: effectiveMode, vaultProvider: targetVault, scope, allowOverwrite: Boolean(allowOverwrite) });
    const captured = await wait(backup, 'backup');
    if (!captured.result?.captureComplete) throw new Error('capture_not_complete');
    status.batchProgress.completedCapsules.push({ sourceRef: curSource, capsuleId: captured.result?.capsuleId, vaultVerified: captured.result?.vaultVerified });
    if (effectiveMode !== 'capsule_only' && curTarget) {
     status.state = 'restoring'; await persist();
     const restore = await command('restore.start', { requestId: randomUUID(), capsuleId: backup.id, confirmTarget: curTarget, acknowledgeManualConfig: true, allowOverwrite: Boolean(allowOverwrite), vaultProvider: targetVault });
     const restored = await wait(restore, 'restore');
     if (!restored.result?.restoreVerified) throw new Error('restore_not_verified');
    }
   }
   status.backupExecuted = true;
   if (effectiveMode !== 'capsule_only') status.restoreExecuted = true;
   status.state = effectiveMode === 'capsule_only' ? 'capsule_delivered' : 'recovery_data_path_verified';
   return;
  }

  if (effectiveMode === 'capsule_only') {
   if (check.source?.ref !== sourceRef || (!check.ready && !allowOverwrite)) throw new Error('unsafe_test_selection');
   status.state = 'capturing';
   const targetVault = vaultProvider || status.activeVault || 'dropbox';
   const backup = await command('backup.start', { requestId: randomUUID(), vault: 'capsule_only', vaultProvider: targetVault, scope, allowOverwrite: Boolean(allowOverwrite) });
   status.backupExecuted = true;
   const captured = await wait(backup, 'backup');
   if (!captured.result?.captureComplete) throw new Error('capture_not_complete');
   if (captured.result?.destinationKind !== targetVault || captured.result?.vaultVerified !== true) throw new Error(targetVault + '_delivery_unverified');
   status.state = 'capsule_delivered';
   return;
  }
  if (effectiveMode === 'restore_only') {
   if (check.target?.ref !== targetRef || (!check.target?.blank && !allowOverwrite) || (!check.ready && !allowOverwrite)) throw new Error('unsafe_test_selection');
   const chosenCapsuleId = dropboxCapsuleId || status.backup?.id || status.backup?.result?.capsuleId;
   if (!chosenCapsuleId) throw new Error('capsule_not_available');
   status.state = 'restoring'; await persist();
   const targetVault = vaultProvider || status.activeVault || 'dropbox';
   const restore = await command('restore.start', {
    requestId: randomUUID(),
    capsuleId: chosenCapsuleId,
    dropboxCapsuleId: targetVault !== 's3' ? (dropboxCapsuleId || status.backup?.result?.capsuleId) : undefined,
    s3CapsuleId: targetVault === 's3' ? (dropboxCapsuleId || status.backup?.result?.capsuleId) : undefined,
    confirmTarget: targetRef,
    acknowledgeManualConfig: true,
    allowOverwrite: Boolean(allowOverwrite),
    vaultProvider: targetVault,
   });
   status.restoreExecuted = true;
   const restored = await wait(restore, 'restore');
   if (!restored.result?.restoreVerified) throw new Error('restore_not_verified');
   status.state = 'recovery_data_path_verified';
   return;
  }
  if(check.source?.ref!==sourceRef||check.target?.ref!==targetRef||(!check.target?.blank&&!allowOverwrite)||(!check.ready&&!allowOverwrite))throw new Error('unsafe_test_selection');
  status.state='capturing';
  const targetVault = effectiveMode === 'temporary_runner' ? 'temporary_runner' : (vaultProvider || status.activeVault || 'dropbox');
  const backup=await command('backup.start',{requestId:randomUUID(),vault:effectiveMode,vaultProvider:targetVault,scope,allowOverwrite:Boolean(allowOverwrite)});
  status.backupExecuted=true;
  const captured=await wait(backup,'backup');
  if(!captured.result?.captureComplete)throw new Error('capture_not_complete');
  if(['dropbox','s3'].includes(targetVault) && (captured.result?.destinationKind!==targetVault||captured.result?.vaultVerified!==true))throw new Error(targetVault+'_delivery_unverified');
  status.state='restoring';await persist();
  const restore=await command('restore.start',{requestId:randomUUID(),capsuleId:backup.id,confirmTarget:targetRef,acknowledgeManualConfig:true,allowOverwrite:Boolean(allowOverwrite),vaultProvider:targetVault});
  status.restoreExecuted=true;
  const restored=await wait(restore,'restore');
  if(!restored.result?.restoreVerified)throw new Error('restore_not_verified');
  status.state='recovery_data_path_verified';
 }catch(e){status.state='drill_failed';status.error=/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'drill_failed';}
 finally{status.executing=false;await persist();}
}
