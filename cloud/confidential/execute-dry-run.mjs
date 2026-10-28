// A live drill writes only the explicitly named, blank synthetic target.
import {randomUUID} from 'node:crypto';
import {validateProjectMapping} from './project-mapping.mjs';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export async function executeDryRun({command,status,persist,sourceRef,targetRef,vault,mode,scope,allowOverwrite=false,dropboxCapsuleId,vaultProvider,sourceRefs,targetMap}) {
 if(status.executing)throw new Error('drill_already_running');
 status.executing=true;status.state='checking_target';await persist();
 try {
  const effectiveMode = mode || vault || 'temporary_runner';
  const plan=validateProjectMapping({sourceRef,targetRef,sourceRefs,targetMap,mode:effectiveMode});
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
   // Check every destination before starting the first capture or restore.
   for(const pair of plan){
    await command('project.select',{slot:'source',ref:pair.source});
    if(pair.target)await command('project.select',{slot:'target',ref:pair.target});
    const checked=await command('preflight',{mode:effectiveMode,allowOverwrite:Boolean(allowOverwrite)});
    if(checked.source?.ref!==pair.source || (pair.target && checked.target?.ref!==pair.target) || !checked.ready)throw new Error('unsafe_test_selection');
   }
   status.batchProgress = { currentIndex: 0, total: sourceRefs.length, completedCapsules: [] };
   for (let i = 0; i < sourceRefs.length; i++) {
    const curSource = sourceRefs[i];
    const curTarget = plan[i].target;
    status.batchProgress.currentIndex = i + 1;
    status.batchProgress.currentRef = curSource;
    await command('project.select', { slot: 'source', ref: curSource });
    if (effectiveMode !== 'capsule_only' && curTarget) {
     await command('project.select', { slot: 'target', ref: curTarget });
    }
    const pairCheck=await command('preflight',{mode:effectiveMode,allowOverwrite:Boolean(allowOverwrite)});
    if(pairCheck.source?.ref!==curSource || (effectiveMode!=='capsule_only' && pairCheck.target?.ref!==curTarget) || !pairCheck.ready)throw new Error('unsafe_test_selection');
    status.state = 'capturing'; await persist();
    const targetVault = (vaultProvider === 's3' || status.activeVault === 's3') ? 's3' : (effectiveMode === 'temporary_runner' ? 'temporary_runner' : 'dropbox');
    const backup = await command('backup.start', { requestId: randomUUID(), vault: targetVault, vaultProvider: targetVault, scope, allowOverwrite: Boolean(allowOverwrite) });
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
   if (check.source?.ref !== sourceRef || !check.ready) throw new Error('unsafe_test_selection');
   status.state = 'capturing';
   const targetVault = (vaultProvider === 's3' || status.activeVault === 's3') ? 's3' : 'dropbox';
   const backup = await command('backup.start', { requestId: randomUUID(), vault: targetVault, vaultProvider: targetVault, scope, allowOverwrite: Boolean(allowOverwrite) });
   status.backupExecuted = true;
   const captured = await wait(backup, 'backup');
   if (!captured.result?.captureComplete) throw new Error('capture_not_complete');
   if (captured.result?.destinationKind !== targetVault || captured.result?.vaultVerified !== true) throw new Error(targetVault + '_delivery_unverified');
   status.state = 'capsule_delivered';
   return;
  }
  if (effectiveMode === 'restore_only') {
   if (check.target?.ref !== targetRef || (!check.target?.blank && !allowOverwrite) || !check.ready) throw new Error('unsafe_test_selection');
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
  if(check.source?.ref!==sourceRef||check.target?.ref!==targetRef||(!check.target?.blank&&!allowOverwrite)||!check.ready)throw new Error('unsafe_test_selection');
  status.state='capturing';
  const targetVault = (effectiveMode === 'dropbox' && (vaultProvider === 's3' || status.activeVault === 's3')) ? 's3' : effectiveMode;
  const backup=await command('backup.start',{requestId:randomUUID(),vault:targetVault,vaultProvider:targetVault,scope,allowOverwrite:Boolean(allowOverwrite)});
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
