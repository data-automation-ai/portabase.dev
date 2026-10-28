import React,{forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import { createHostedRunner, managedScope, newRecoveryKey, evidenceReport } from './hosted-runner.mjs';
import { ensureSessionForVersion } from '../lib/cloud-api.js';
import { authHeaders, loadSession } from '../lib/session.js';
import './managed-runner-panel.css';

function download(name,value,type='application/json') {
  const url=URL.createObjectURL(new Blob([typeof value==='string'?value:JSON.stringify(value,null,2)],{type}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const messages={profile_revision_conflict:'Your encrypted profile changed in another tab. Close this runner view and reopen it before continuing.',profile_unlock_failed:'This key does not unlock your saved recovery profile. Enter the key you saved previously.',confidential_policy_unavailable:'The approved runner release is not available yet. No key or job was sent.',daily_limit_reached:'Your daily run allowance has been reached.',incremental_binary_requires_durable_vault:'The $9 plan requires a durable vault for its initial and incremental Storage objects.',restore_target_not_blank:'The destination contains existing data. Review the destination and explicitly authorize replacement to continue.',oauth_connection_required:'Authorize the account connection above, then check the runner again.'};
export const ManagedRunnerPanel=forwardRef(function ManagedRunnerPanel({workspace,onStatus,onWorkspace,disabled=false,runnerFactory=createHostedRunner},ref){
  const [expanded,setExpanded]=useState(false),[key,setKey]=useState(''),[saved,setSaved]=useState(false),[unlocked,setUnlocked]=useState(false);
  const [working,setWorking]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[preflight,setPreflight]=useState(null);
  const [scopeAcknowledged,setScopeAcknowledged]=useState(false),[overwrite,setOverwrite]=useState(false),[roleArn,setRoleArn]=useState('');
  const [beaconConsent,setBeaconConsent]=useState(false),[beaconState,setBeaconState]=useState(null);
  const [lastStatus,setLastStatus]=useState({}),[existingCapsule,setExistingCapsule]=useState('');
  const accessKey=useRef(null),secretKey=useRef(null),runnerRef=useRef(null),abortRef=useRef(null),workspaceRef=useRef(workspace);workspaceRef.current=workspace;
  const busyRef=useRef(false);
  const selectionSignature=JSON.stringify({selection:workspace.selection,databases:workspace.databases,mode:workspace.mode,activeVault:workspace.activeVault,vaultLocations:workspace.vaultLocations});
  useEffect(()=>{setScopeAcknowledged(false);setPreflight(null);},[selectionSignature]);
  function status(value){setLastStatus(current=>({...current,...value}));if(value.message)setMessage(value.message);onStatus?.(value);if(value.backup?.state==='complete'||value.backup?.state==='failed'||value.restore?.state==='complete'||value.restore?.state==='failed')window.dispatchEvent(new Event('portabase-runner-usage-changed'));}
  function runner(){
    if(!runnerRef.current)runnerRef.current=runnerFactory({authorization:async()=>{await ensureSessionForVersion('supabase');const value=authHeaders(loadSession()).Authorization;if(!value)throw Error('Sign in again before starting a runner.');return value;},onStatus:status});
    return runnerRef.current;
  }
  async function work(task){
    if(busyRef.current)return;busyRef.current=true;setWorking(true);setError('');status({busy:true});
    try{await task();}catch(e){setError(e.message==='profile_changed_reload_required'?'Your encrypted profile changed in another tab. Reopen the runner controls before continuing.':e.message==='provider_connection_required'?'Authorize this provider connection, then check the runner again.':messages[e.message]||e.message||'The runner request failed.');status({state:'drill_failed',error:e.message});}
    finally{busyRef.current=false;setWorking(false);status({busy:false});}
  }
  async function unlock(){
    if(!saved){setError('Save your recovery key and confirm below before unlocking.');return;}
    await work(async()=>{abortRef.current=new AbortController();const opened=await runner().unlock(key.trim(),{signal:abortRef.current.signal});setKey('');setUnlocked(true);status({unlocked:true});onWorkspace?.({connections:opened.connected});});
  }
  async function configure(){
    const state=workspaceRef.current,mode=state.mode||'dropbox',service=runner();
    if(!unlocked)throw Error('Unlock the secure runner first.');
    const source=state.selection.source,target=state.selection.target;
    if(mode!=='restore_only'&&!/^[a-z0-9]{20}$/.test(source||''))throw Error('Choose the source project.');
    if(mode!=='capsule_only'&&!/^[a-z0-9]{20}$/.test(target||''))throw Error('Choose a separate destination project.');
    if(source&&target===source)throw Error('The destination must differ from the source.');
    const scope=mode==='restore_only'?null:managedScope(state);
    const connected=service.connected();
    for(const slot of mode==='capsule_only'?['source']:mode==='restore_only'?['target']:['source','target']){
      if(!connected[slot])await service.importConnection('supabase',slot);
      await service.command('project.select',{slot,ref:slot==='source'?source:target});
    }
    if(mode!=='capsule_only'&&mode!=='restore_only'&&state.accountConfirmation?.confirmed)
      await service.command('oauth.account.confirm',{sourceEmail:state.accountConfirmation.sourceEmail,targetEmail:state.accountConfirmation.targetEmail});
    const provider=state.activeVault||'dropbox';
    if(mode!=='temporary_runner'){
      if(provider==='dropbox'){
        if(!connected.dropbox)await service.importConnection('dropbox');
      } else if(provider==='s3'||provider==='r2'){
        const location=state.vaultLocations?.[provider];
        if(!location)throw Error('Save the vault bucket and folder in the recovery diagram first.');
        if(location.naming==='overwrite')throw Error('Hosted runs currently retain dated capsules. Select date-stamped naming before running.');
        if(!connected[provider]||roleArn||accessKey.current?.value){
          if(provider==='s3'&&!roleArn.trim())throw Error('Enter the customer vault IAM role ARN below.');
          if(provider==='r2'&&(!accessKey.current?.value||!secretKey.current?.value))throw Error('Enter the R2 access key and secret below.');
          await service.command(`vault.${provider}.connect`,{...location,...(provider==='s3'?{roleArn:roleArn.trim()}:{accessKeyId:accessKey.current.value,secretAccessKey:secretKey.current.value})});
          if(accessKey.current)accessKey.current.value='';if(secretKey.current)secretKey.current.value='';
        }
      }else throw Error('Choose Dropbox, Amazon S3, or Cloudflare R2 for managed capsule delivery.');
      await service.command('vault.select',{provider});
    }
    const checked=await service.command('preflight',{mode,allowOverwrite:overwrite});
    if(!checked.ready)throw Error('Preflight did not pass. Review the destination and account confirmation.');
    if(mode!=='capsule_only'&&checked.target?.ref!==target)throw Error('The verified destination does not match your selection.');
    if(mode!=='restore_only'&&checked.source?.ref!==source)throw Error('The verified source does not match your selection.');
    if(mode!=='capsule_only'&&checked.target?.blank!==true&&!overwrite)throw Error('The destination is not blank. Review it before authorizing replacement.');
    const setup={mode,provider,source,target,scope,overwrite};setPreflight(checked);
    status({state:'preflight_passed',preflight:checked,executing:false});setMessage('Preflight passed. Review the scope and authorize the run.');
    onWorkspace?.({connections:service.connected()});
    return setup;
  }
  async function execute(options={}){
    setExpanded(true);
    if(!scopeAcknowledged&&!options.acknowledgeScope){setError('Authorize the scope below before running.');return;}
    await work(async()=>{
      // A fresh check precedes every run; old browser inventory cannot authorize writes.
      const setup=await configure(),service=runner();
      status({executing:true});abortRef.current=new AbortController();
      let captured;
      try{
        if(setup.mode!=='restore_only'){
          const job=await service.command('backup.start',{requestId:crypto.randomUUID(),vault:setup.mode==='temporary_runner'?'temporary_runner':setup.mode==='capsule_only'?'capsule_only':'dropbox',vaultProvider:setup.provider,scope:setup.scope,allowOverwrite:setup.overwrite});
          captured=await service.waitJob(job,'backup',{signal:abortRef.current.signal});
          if(captured.result?.captureComplete!==true)throw Error('Backup completeness was not confirmed.');
          if(setup.mode!=='temporary_runner'&&captured.result?.vaultVerified!==true)throw Error('Vault delivery was not verified. No restore was started.');
          status({backupExecuted:true});
        }
        if(setup.mode!=='capsule_only'){
          const capsule=setup.mode==='restore_only'?existingCapsule.trim():captured.id;
          if(!capsule)throw Error('Enter the existing capsule ID before restoring.');
          const job=await service.command('restore.start',{requestId:crypto.randomUUID(),capsuleId:capsule,...(setup.mode==='restore_only'?{dropboxCapsuleId:capsule}:{}),vault:setup.mode==='restore_only'?'restore_only':undefined,vaultProvider:setup.provider,confirmTarget:setup.target,acknowledgeManualConfig:true,allowOverwrite:setup.overwrite});
          const restored=await service.waitJob(job,'restore',{signal:abortRef.current.signal});
          if(restored.result?.restoreVerified!==true)throw Error('The restore comparison did not pass.');
          status({restoreExecuted:true,state:'recovery_data_path_verified'});
          setMessage('Restore comparison passed. Test your application and configure provider settings separately.');
        }else{status({state:'capsule_delivered'});setMessage('Encrypted capsule delivery and integrity verified. A restore drill is still a separate check.');}
      }finally{status({executing:false});}
    });
  }
  async function refreshConnections(){
    if(!unlocked||busyRef.current)return;
    const service=runner(),connected=service.connected(),projects={};
    for(const slot of ['source','target'])if(connected[slot]){const result=await service.command('projects.list',{slot});projects[slot]=result.projects;}
    onWorkspace?.({connections:connected,projects});
  }
  async function selectProject(slot,ref){
    const service=runner();const inspection=await service.command('project.select',{slot,ref});
    const result={inspections:{[slot]:inspection}};
    if(slot==='source'){const data=await service.command('source.inventory');result.inventory=data.inventory;}
    onWorkspace?.(result);return inspection;
  }
  useImperativeHandle(ref,()=>({execute,refreshConnections,selectProject,open:()=>setExpanded(true),certificate:()=>{try{download('portabase-google-attestation.json',evidenceReport(runner().evidence()));}catch(e){setError(e.message);setExpanded(true);}}}));
  return <section className="pb-managed" aria-label="Secure cloud runner">
    <header><div><strong>Secure cloud runner</strong><span>{unlocked?'Unlocked · key stays in the enclave':'Unlock with your recovery key to run the selected recovery'}</span></div><button type="button" onClick={()=>setExpanded(!expanded)}>{expanded?'Hide controls':'Open runner controls'}</button></header>
    {expanded&&<div className="pb-managed-body">
      {!unlocked&&<div className="pb-managed-key"><label>Recovery key<input type="password" value={key} onChange={e=>{setKey(e.target.value);setSaved(false);}} autoComplete="off" spellCheck={false} placeholder="Enter your existing 43-character key" disabled={working}/></label><div className="pb-managed-actions"><button type="button" disabled={working} onClick={()=>{setKey(newRecoveryKey());setSaved(false);}}>Create a new key</button><button type="button" disabled={working||!/^[A-Za-z0-9_-]{43}$/.test(key)} onClick={()=>download('portabase-recovery-key.txt',key+'\n','text/plain')}>Save key file</button></div><p>Use the same key for existing backups. Keep it somewhere safe: Portabase cannot recover it. Your browser verifies Google’s signed attestation before sending the key to the enclave.</p><label className="pb-managed-check"><input type="checkbox" checked={saved} onChange={e=>setSaved(e.target.checked)} disabled={working}/>I have saved this recovery key outside this browser.</label><button type="button" className="primary" disabled={working||disabled||!saved} onClick={unlock}>{working?'Starting secure runner…':'Unlock secure runner'}</button></div>}
      {unlocked&&<>
        <p>Managed capture includes the complete database schema, Auth and Edge Functions, selected table row data, and selected whole Storage buckets. Individual-file and schema-only selections are checked before a run.</p>
        {workspace.activeVault==='s3'&&<label>Customer vault IAM role ARN<input value={roleArn} onChange={e=>setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/customer-vault" disabled={working}/></label>}
        {workspace.activeVault==='r2'&&<div className="pb-managed-columns"><label>R2 access key<input ref={accessKey} type="password" autoComplete="off" disabled={working}/></label><label>R2 secret key<input ref={secretKey} type="password" autoComplete="off" disabled={working}/></label></div>}
        {workspace.mode==='restore_only'&&<label>Existing capsule ID<input value={existingCapsule} onChange={e=>setExistingCapsule(e.target.value)} disabled={working}/></label>}
        {workspace.mode!=='capsule_only'&&<label className="pb-managed-check"><input type="checkbox" checked={overwrite} onChange={e=>{setOverwrite(e.target.checked);setPreflight(null);}} disabled={working}/><span>Allow replacement of existing objects in destination <code>{workspace.selection?.target||'(choose a destination)'}</code>.</span></label>}
        <label className="pb-managed-check"><input type="checkbox" checked={scopeAcknowledged} onChange={e=>setScopeAcknowledged(e.target.checked)} disabled={working}/>I authorize this scope{workspace.mode!=='capsule_only'?' and the restore into the selected destination':''}. I will configure provider settings and test the application separately.</label>
        <div className="pb-managed-actions"><button type="button" disabled={working||disabled} onClick={()=>work(configure)}>Check selected recovery</button><button type="button" className="primary" disabled={working||disabled||!scopeAcknowledged} onClick={()=>execute()}>{working?'Working…':workspace.mode==='capsule_only'?'Run backup':workspace.mode==='restore_only'?'Run restore':'Run capture and restore'}</button><button type="button" disabled={working} onClick={()=>{const profile=runner().exportProfile();if(profile)download('portabase-encrypted-profile.json',profile);}}>Export encrypted profile</button><button type="button" disabled={working} onClick={()=>work(async()=>{await runner().stop();setUnlocked(false);setSaved(false);setPreflight(null);status({unlocked:false});})}>Stop runner</button></div>
        {preflight&&<p className="pb-managed-positive">Preflight checked {preflight.target?.ref||preflight.source?.ref}. {preflight.target?.blank===true?'Destination is blank.':preflight.target?'Destination contains existing objects.':'Backup only; no destination write.'}</p>}
        <details><summary>Free destination keep-alive</summary><p>Enable a database query every 3 days. Portabase retains a separate encrypted destination authorization protected by Google KMS and the approved enclave policy, so a beacon can run without your recovery key. This helps with inactivity pauses; it does not guarantee provider availability.</p><label className="pb-managed-check"><input type="checkbox" checked={beaconConsent} onChange={e=>setBeaconConsent(e.target.checked)} disabled={working}/>I authorize unattended activity queries to the selected destination.</label><div className="pb-managed-actions"><button type="button" disabled={working||!beaconConsent||!workspace.selection?.target} onClick={()=>work(async()=>{const result=await runner().command('beacon.configure',{enabled:true,refs:[workspace.selection.target],acknowledgeDelegation:true});setBeaconState(result);})}>Enable free beacon</button><button type="button" disabled={working} onClick={()=>work(async()=>{setBeaconState(await runner().command('beacon.configure',{enabled:false}));})}>Disable beacon</button></div>{beaconState&&<p>{beaconState.enabled?'Beacon enabled for the selected destination.':'Beacon disabled.'}</p>}</details>
      </>}
      {message&&<p role="status">{message}</p>}
      {lastStatus.backup&&<p>Backup: {lastStatus.backup.state}{lastStatus.backup.phase?` · ${lastStatus.backup.phase}`:''}{Number.isFinite(lastStatus.backup.estimatedPercent)?` · approximately ${lastStatus.backup.estimatedPercent}%`:''}</p>}
      {lastStatus.restore&&<p>Restore: {lastStatus.restore.state}{lastStatus.restore.phase?` · ${lastStatus.restore.phase}`:''}</p>}
      {error&&<p className="pb-managed-error" role="alert">{error}</p>}
    </div>}
  </section>;
});
