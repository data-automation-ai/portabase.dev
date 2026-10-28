import test from 'node:test';
import assert from 'node:assert/strict';
import {sealProfile} from './customer-profile.mjs';
import {confidentialApplication} from './application.mjs';
import {FIXTURE,parseProofOptions,runProofCommands} from './isolated-recovery-proof.mjs';
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
test('harness defaults to metadata plan and requires explicit digest, identity, start and proof scope',()=>{
 assert.equal(parseProofOptions([]).action,'plan');
 assert.throws(()=>parseProofOptions(['proof']),/reviewed_digest_required/);
 const args=['inspect','--digest=sha256:'+'1'.repeat(64),'--identity='+FIXTURE.identity,'--source='+FIXTURE.source,'--target='+FIXTURE.target];
 assert.throws(()=>parseProofOptions(args),/explicit_runner_start_required/);
 assert.equal(parseProofOptions([...args,'--start-runner=yes']).action,'inspect');
 assert.throws(()=>parseProofOptions(['proof',...args.slice(1),'--start-runner=yes']),/explicit_proof_scope_required/);
 assert.throws(()=>parseProofOptions([...args,'--allow-overwrite=true']),/invalid_proof_option/);
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
