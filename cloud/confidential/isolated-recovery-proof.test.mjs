import test from 'node:test';
import assert from 'node:assert/strict';
import {sealProfile,openProfile} from './customer-profile.mjs';
import {confidentialApplication} from './application.mjs';
import {FIXTURE,parseProofOptions,runProofCommands,attestedProofCommand} from './isolated-recovery-proof.mjs';
const owner='a'.repeat(64),recoveryKey=Buffer.alloc(32,7).toString('base64url');
test('session boundary rejects missing or foreign selections before automatic provider access',async()=>{
 for(const selection of [{},{source:'a'.repeat(20),target:FIXTURE.target},{source:FIXTURE.source,target:'b'.repeat(20)}]){
  let touched=false;
  const app=confidentialApplication({connections:{},vault:{provider:async()=>{touched=true;throw Error('must_not_access');}}});
  const sealedProfile=await sealProfile({version:1,owner,connections:{},selection,dropbox:{refreshToken:'fake'}},recoveryKey);
  await assert.rejects(app({owner,operation:'session.open',input:{recoveryKey,sealedProfile,expectedSelection:{source:FIXTURE.source,target:FIXTURE.target}}}),/session_selection_mismatch/);
  assert.equal(touched,false);
 }
});
test('normal customer sessions are unchanged and valid fixture boundary opens without provider access',async()=>{
 const app=confidentialApplication({connections:{},vault:null});
 const result=await app({owner,operation:'session.open',input:{recoveryKey}});
 assert.deepEqual(result.selection,{});
 const profile={version:1,owner,connections:{},selection:{source:FIXTURE.source,target:FIXTURE.target}};
 const other=confidentialApplication({connections:{},vault:null});
 const opened=await other({owner,operation:'session.open',input:{recoveryKey,sealedProfile:await sealProfile(profile,recoveryKey),expectedSelection:profile.selection}});
 assert.deepEqual(opened.selection,profile.selection);
 await assert.rejects(other({owner,operation:'session.open',input:{recoveryKey,expectedSelection:{source:'a'.repeat(20),target:FIXTURE.target}}}),/session_selection_mismatch/);
});
test('explicit rebind changes only selection inside the enclave and never accesses the old vault or provider',async()=>{
 const profile={version:1,owner,connections:{source:{accessToken:'fake-source'},target:{accessToken:'fake-target'}},selection:{source:'c'.repeat(20),target:'d'.repeat(20),sources:['c'.repeat(20)],targetMap:{old:'d'.repeat(20)}},dropbox:{refreshToken:'fake-refresh'},s3:{bucket:'old-vault'},activeVault:'s3',keyAcknowledged:true,accountConfirmation:{method:'manual',sourceGrantId:'one',targetGrantId:'two'}};
 let providerCalls=0;
 const forbidden=async()=>{providerCalls++;throw Error('must_not_access_provider');};
 const app=confidentialApplication({connections:{access:forbidden},vault:{provider:forbidden},s3:{provider:forbidden}});
 const selection={source:FIXTURE.source,target:FIXTURE.target};
 const result=await app({owner,operation:'session.open',input:{recoveryKey,sealedProfile:await sealProfile(profile,recoveryKey),expectedSelection:selection,rebindSelection:selection}});
 assert.equal(providerCalls,0);assert.equal(result.selectionRebound,true);assert.equal(result.binaryCatalog.state,'deferred');
 assert.deepEqual(await openProfile(result.sealedProfile,recoveryKey,owner),{...profile,selection});
 // Existing sessions obey the same explicit configuration and no-provider rule.
 const again=await app({owner,operation:'session.open',input:{recoveryKey,expectedSelection:selection,rebindSelection:selection}});
 assert.equal(again.selectionRebound,true);assert.equal(providerCalls,0);
});
test('rebind rejects protected targets, identical projects, mismatched boundaries and missing boundary',async()=>{
 const selection={source:FIXTURE.source,target:FIXTURE.target};
 const profile={version:1,owner,connections:{},selection};
 const sealedProfile=await sealProfile(profile,recoveryKey);
 for(const input of [
  {rebindSelection:{source:FIXTURE.source,target:FIXTURE.auth},expectedSelection:{source:FIXTURE.source,target:FIXTURE.auth}},
  {rebindSelection:{source:FIXTURE.source,target:FIXTURE.source},expectedSelection:selection},
  {rebindSelection:{source:'e'.repeat(20),target:FIXTURE.target},expectedSelection:selection},
  {rebindSelection:selection},
 ]){
  const app=confidentialApplication({connections:{},vault:null});
  await assert.rejects(app({owner,operation:'session.open',input:{recoveryKey,sealedProfile,...input}}),/invalid_(rebind|expected)_selection/);
 }
});
test('harness defaults to metadata plan and requires explicit digest, identity, start and proof scope',()=>{
 assert.equal(parseProofOptions([]).action,'plan');
 assert.throws(()=>parseProofOptions(['proof']),/reviewed_digest_required/);
 const args=['inspect','--digest=sha256:'+'1'.repeat(64),'--identity='+FIXTURE.identity,'--source='+FIXTURE.source,'--target='+FIXTURE.target];
 assert.throws(()=>parseProofOptions(args),/explicit_runner_start_required/);
 assert.equal(parseProofOptions([...args,'--start-runner=yes']).action,'inspect');
 assert.equal(parseProofOptions([...args,'--start-runner=yes','--rebind-fixture=yes'])['rebind-fixture'],'yes');
 assert.throws(()=>parseProofOptions(['proof',...args.slice(1),'--start-runner=yes','--vault=s3','--confirm-scope=synthetic-drill-v1','--rebind-fixture=yes']),/rebind_requires_explicit_inspect/);
 assert.throws(()=>parseProofOptions(['plan','--rebind-fixture=yes']),/rebind_requires_explicit_inspect/);
 assert.throws(()=>parseProofOptions(['proof',...args.slice(1),'--start-runner=yes']),/explicit_proof_scope_required/);
 assert.throws(()=>parseProofOptions([...args,'--allow-overwrite=true']),/invalid_proof_option/);
});
test('attestation status is emitted only from fresh verified client evidence, even on a workload rejection',async()=>{
 let evidence=null;const logs=[];
 const client={evidence:()=>evidence,command:async()=>{throw Error('attestation_invalid');}};
 await assert.rejects(attestedProofCommand(client,'session.open',{},row=>logs.push(row)));assert.equal(logs.length,0);
 client.command=async()=>{evidence={imageDigest:'sha256:'+'a'.repeat(64),hardware:'GCP_INTEL_TDX',projectNumber:'495102144848',verifiedAt:'2026-10-28T00:00:00Z',attestationToken:'must-not-log'};throw Error('session_selection_mismatch');};
 await assert.rejects(attestedProofCommand(client,'session.open',{},row=>logs.push(row)),/session_selection_mismatch/);
 assert.equal(logs.length,1);assert.equal(logs[0].stage,'attestation_verified');assert.equal(JSON.stringify(logs).includes('must-not-log'),false);
 client.command=async()=>{throw Error('transport_failed');};
 await assert.rejects(attestedProofCommand(client,'session.open',{},row=>logs.push(row)));assert.equal(logs.length,1);
});
function harness({blank=true,scopeChanged=false}={}){
 const calls=[];let backups=0;
 const source={ref:FIXTURE.source,applicationTables:1,authUsers:1,storageObjects:1,functions:1};
 const command=async(op,input)=>{
  calls.push({op,input});
  if(op==='projects.list')return {projects:[{ref:FIXTURE[input.slot]}]};
  if(op==='source.inventory')return {inventory:{ref:FIXTURE.source,tables:[{name:scopeChanged?'public.extra':'public.portabase_drill_items'}],buckets:[{id:'portabase-drill-private'}]}};
  if(op==='preflight')return {source,target:{ref:FIXTURE.target,blank},ready:blank};
  if(op==='backup.start'){backups++;return {id:'11111111-1111-4111-8111-111111111111'};}
  if(op==='restore.start')return {id:'22222222-2222-4222-8222-222222222222'};
  if(op==='job.status')return {id:input.id,state:'complete',result:{captureComplete:true,vaultVerified:true,destinationKind:'s3',restoreVerified:true}};
  throw Error('unexpected_operation');
 };
 return {command,calls,get backups(){return backups;}};
}
test('inspect never starts a backup or restore and proof refuses changed scope or nonblank target',async()=>{
 const h=harness();const result=await runProofCommands({...h,options:{action:'inspect'}});
 assert.equal(result.proofExecuted,false);assert.equal(h.calls.some(c=>c.op.endsWith('.start')),false);
 for(const settings of [{blank:false},{scopeChanged:true}]){
  const blocked=harness(settings);await assert.rejects(runProofCommands({...blocked,options:{action:'proof',vault:'s3'}}));assert.equal(blocked.backups,0);
 }
});
test('explicit S3 proof uses hosted protocol, verified capture and repeated blank check before exact target restore',async()=>{
 const h=harness();const result=await runProofCommands({...h,options:{action:'proof',vault:'s3'}});
 assert.equal(result.restoreVerified,true);assert.equal(result.independentRecoveryDrill,false);
 const backup=h.calls.find(c=>c.op==='backup.start').input,restore=h.calls.find(c=>c.op==='restore.start').input;
 assert.equal(backup.vault,'dropbox');assert.equal(backup.vaultProvider,'s3');assert.equal(backup.allowOverwrite,false);
 assert.equal(restore.confirmTarget,FIXTURE.target);assert.equal(restore.capsuleId,'11111111-1111-4111-8111-111111111111');assert.equal(restore.allowOverwrite,false);
 assert.equal(h.calls.filter(c=>c.op==='preflight').length,2);
});
