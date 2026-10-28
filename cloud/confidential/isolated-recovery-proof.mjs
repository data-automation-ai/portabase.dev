// Operator-only. No plaintext credentials or backup data are written locally.
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {operatorGoogle} from './operator-google.mjs';
import {confidentialClient} from './client.mjs';
export const FIXTURE={auth:'eoiqvdmvgaurlecdzqkp',identity:'6f454f7b-b490-4fe9-9c49-48ce5b6f4408',source:'uloqvqdkeiwvnnnfdvrc',target:'jmqjsyyyhhwvkbqexxog'};
const ROOT='/v1/projects/portabase-dev/secrets/';
const PROFILE=ROOT+'portabase-confidential-validation-profile';
const CONTROLLER='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const SCOPE={tables:['public.portabase_drill_items'],excludedTables:[],buckets:['portabase-drill-private'],auth:true,functions:true};
const fail=code=>{throw Error(code);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function parseProofOptions(args){
 const action=args[0]||'plan',options={action};
 if(!['plan','inspect','proof'].includes(action))fail('invalid_proof_action');
 for(const arg of args.slice(1)){
  const match=/^--(digest|identity|source|target|vault|confirm-scope|start-runner)=(.+)$/.exec(arg);
  if(!match||options[match[1]]!==undefined)fail('invalid_proof_option');options[match[1]]=match[2];
 }
 if(action==='plan')return options;
 if(!/^sha256:[a-f0-9]{64}$/.test(options.digest||''))fail('reviewed_digest_required');
 if(options.identity!==FIXTURE.identity||options.source!==FIXTURE.source||options.target!==FIXTURE.target)fail('exact_fixture_identity_required');
 if(options['start-runner']!=='yes')fail('explicit_runner_start_required');
 if(action==='proof'&&(!['s3','dropbox'].includes(options.vault)||options['confirm-scope']!=='synthetic-drill-v1'))fail('explicit_proof_scope_required');
 return options;
}
const projectSummary=p=>({ref:p.ref,blank:p.blank,applicationTables:p.applicationTables,authUsers:p.authUsers,storageObjects:p.storageObjects,functions:p.functions,databaseBytes:p.databaseBytes,storageBytes:p.storageBytes});
const safeError=error=>/^[a-z0-9_]{3,100}$/.test(error?.message||'')?error.message:'isolated_proof_failed';
export async function runProofCommands({command,options,report=()=>{},wait=sleep}){
 const expected={source:FIXTURE.source,target:FIXTURE.target};
 // session.open's boundary must already have rejected any stale foreign refs.
 const grants={};
 for(const slot of ['source','target']){
  const result=await command('projects.list',{slot});
  grants[slot]=Array.isArray(result.projects)&&result.projects.some(p=>p.ref===expected[slot]);
  if(!grants[slot])fail('fixture_project_not_in_grant');
 }
 const inv=(await command('source.inventory')).inventory;
 if(inv?.ref!==FIXTURE.source||!Array.isArray(inv.tables)||!Array.isArray(inv.buckets))fail('fixture_inventory_mismatch');
 // Never widen a fixture proof if new tables or buckets have appeared.
 if(inv.tables.length!==1||inv.tables[0].name!==SCOPE.tables[0]||inv.buckets.length!==1||inv.buckets[0].id!==SCOPE.buckets[0])fail('fixture_scope_changed');
 report({stage:'inventory',source:FIXTURE.source,tables:1,buckets:1,grants});
 const check=await command('preflight',{mode:'dropbox',allowOverwrite:false});
 if(check.source?.ref!==FIXTURE.source||check.target?.ref!==FIXTURE.target)fail('fixture_selection_changed');
 report({stage:'preflight',ready:check.ready===true,source:projectSummary(check.source),target:projectSummary(check.target)});
 if(options.action==='inspect')return {action:'inspect',ready:check.ready===true&&check.target.blank===true,proofExecuted:false};
 if(!check.ready||check.target.blank!==true||check.source.applicationTables!==1||check.source.authUsers!==1||check.source.storageObjects!==1||check.source.functions!==1)fail('fixture_blank_target_and_scope_required');
 async function complete(job){
  if(!/^[a-f0-9-]{36}$/i.test(job?.id||''))fail('invalid_proof_job');
  const deadline=Date.now()+90*60_000;let prior='';
  while(Date.now()<deadline){
   const current=await command('job.status',{id:job.id});
   if(current.id!==job.id)fail('proof_job_identity_mismatch');
   if(current.state!==prior){report({stage:'job',id:job.id,state:current.state});prior=current.state;}
   if(current.state==='failed')fail('isolated_job_failed');
   if(current.state==='complete')return current;
   await wait(4000);
  }
  fail('proof_job_timeout');
 }
 const backup=await command('backup.start',{requestId:randomUUID(),vault:'dropbox',vaultProvider:options.vault,scope:SCOPE,allowOverwrite:false});
 const captured=await complete(backup);
 if(captured.result?.captureComplete!==true||captured.result?.vaultVerified!==true||captured.result?.destinationKind!==options.vault)fail('durable_capture_unverified');
 // Recheck immediately before target mutation. No overwrite escape hatch.
 const again=await command('preflight',{mode:'dropbox',allowOverwrite:false});
 if(again.source?.ref!==FIXTURE.source||again.target?.ref!==FIXTURE.target||again.target.blank!==true||again.ready!==true)fail('fixture_target_changed');
 const restore=await command('restore.start',{requestId:randomUUID(),capsuleId:backup.id,confirmTarget:FIXTURE.target,acknowledgeManualConfig:true,allowOverwrite:false,vaultProvider:options.vault});
 const restored=await complete(restore);
 if(restored.result?.restoreVerified!==true)fail('restore_unverified');
 return {action:'proof',proofExecuted:true,captureComplete:true,vaultVerified:true,restoreVerified:true,backupJobId:backup.id,restoreJobId:restore.id,independentRecoveryDrill:false};
}
export async function main(args=process.argv.slice(2)){
 const options=parseProofOptions(args),google=await operatorGoogle();
 const report=row=>console.log(JSON.stringify(row));
 if(options.action==='plan'){
  for(const name of ['portabase-confidential-validation','portabase-confidential-validation-profile','portabase-confidential-oauth']){
   const meta=await google(ROOT+name+'/versions/latest');
   report({secret:name,present:!!meta,state:meta?.state,version:meta?.name?.split('/').at(-1),payloadAccessed:false});
  }
  return;
 }
 const stored=await google(ROOT+'portabase-confidential-validation/versions/latest:access');
 const fixture=JSON.parse(Buffer.from(stored?.payload?.data||'','base64').toString());
 if(fixture.projectRef!==FIXTURE.auth||fixture.id!==FIXTURE.identity||typeof fixture.password!=='string'||!fixture.password||typeof fixture.email!=='string')fail('fixture_identity_mismatch');
 const envelope=await google(PROFILE+'/versions/latest:access');
 let version=envelope?.name,sealedProfile=JSON.parse(Buffer.from(envelope?.payload?.data||'','base64').toString()).sealedProfile;
 if(typeof sealedProfile!=='string'||!sealedProfile||!version)fail('saved_fixture_profile_required');
 let session;
 const authorization=async()=>{
  if(!session||session.expires_at<Date.now()/1000+120){
   const response=await fetch(`https://${FIXTURE.auth}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:'sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL','content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password}),redirect:'error',signal:AbortSignal.timeout(20000)});
   if(!response.ok)fail('fixture_login_failed');session=await response.json();
   if(session.user?.id!==FIXTURE.identity||!session.access_token)fail('fixture_identity_mismatch');
  }
  return 'Bearer '+session.access_token;
 };
 const client=confidentialClient({url:CONTROLLER,policy:{hardware:'GCP_INTEL_TDX',projectNumber:'495102144848',imageDigest:options.digest,workload:'application'},getAuthorization:authorization});
 // Every response's possibly rotated grant is sealed and durable before another
 // provider command. Single operator owns this fixture; concurrent writes fail.
 async function command(operation,input){
  const result=await client.command(operation,input);
  if(typeof result.sealedProfile!=='string')fail('sealed_profile_response_required');
  const latest=await google(PROFILE+'/versions/latest');
  if(latest?.name!==version)fail('fixture_profile_changed_concurrently');
  const saved=await google(PROFILE+':addVersion',{method:'POST',body:{payload:{data:Buffer.from(JSON.stringify({sealedProfile:result.sealedProfile})).toString('base64')}}});
  if(!saved?.name||saved.state!=='ENABLED')fail('sealed_profile_save_failed');
  const savedVersion=saved.name.split('/').at(-1);
  if(!/^\d+$/.test(savedVersion))fail('sealed_profile_save_failed');
  const verified=await google(PROFILE+'/versions/'+savedVersion+':access');
  const readback=JSON.parse(Buffer.from(verified?.payload?.data||'','base64').toString());
  if(readback.sealedProfile!==result.sealedProfile||(await google(PROFILE+'/versions/latest'))?.name!==saved.name)fail('sealed_profile_readback_failed');
  version=saved.name;sealedProfile=result.sealedProfile;delete result.sealedProfile;
  return result;
 }
 const requestId=randomUUID(),deadline=Date.now()+8*60_000;
 for(;;){const ready=await client.session(requestId);if(ready.state==='ready')break;if(Date.now()>deadline)fail('runner_start_timeout');await sleep(6000);}
 const recoveryKey=createHash('sha256').update('portabase-isolated-validation:'+fixture.password).digest('base64url');
 const opened=await command('session.open',{recoveryKey,sealedProfile,expectedSelection:{source:FIXTURE.source,target:FIXTURE.target}});
 report({stage:'session',attestationVerified:true,imageDigest:options.digest,connections:{source:opened.connected?.source===true,target:opened.connected?.target===true,dropbox:opened.connected?.dropbox===true,s3:opened.connected?.s3===true},accountConfirmed:opened.accountConfirmation?.confirmed===true,keyAcknowledged:opened.keyAcknowledged===true});
 if(!opened.connected?.source||!opened.connected?.target)fail('fixture_provider_consent_required');
 if(options.action==='proof'&&!opened.connected?.[options.vault])fail('fixture_vault_consent_required');
 report(await runProofCommands({command,options,report}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{console.error(JSON.stringify({error:safeError(error)}));process.exitCode=1;});
