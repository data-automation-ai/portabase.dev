import test from 'node:test';
import assert from 'node:assert/strict';
import { createHostedRunner,managedScope,evidenceReport,newRecoveryKey } from '../src/console/hosted-runner.mjs';
const key='a'.repeat(43),policy={imageDigest:`sha256:${'a'.repeat(64)}`,projectNumber:'495102144848',hardware:'GCP_INTEL_TDX',workload:'application'};
const controllerUrl='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
function fixture({saveFails=false,controller=controllerUrl}={}){
  const calls=[];let revision=null;
  const runner=createHostedRunner({authorization:async()=>'Bearer fixture',sleep:async()=>{},
    fetchImpl:async(url,options)=>{const body=options.body?JSON.parse(options.body):null;calls.push({type:'api',method:options.method,body});
      if(options.method==='GET')return Response.json({policy,controllerUrl:controller,sealedProfile:null,profileRevision:revision});
      if(options.method==='PUT'){if(saveFails)return Response.json({error:'profile_changed_reload_required'},{status:409});revision=String(Number(revision||0)+1);return Response.json({profileRevision:revision});}
      if(body.action==='bridge')return Response.json({envelope:'opaque',bridgeId:'bridge-id'});
      return Response.json({ok:true});},
    clientFactory:()=>({session:async()=>({state:'ready'}),evidence:()=>({imageDigest:policy.imageDigest}),terminate:async()=>{},
      command:async(operation,input,options)=>{calls.push({type:'command',operation,input});if(options?.envelopeFactory)await options.envelopeFactory({offer:{},challenge:'nonce',responseKey:'response-key'});return {connected:{source:false},sealedProfile:'encrypted-profile'};}})});
  return {runner,calls};
}
test('recovery key reaches only encrypted client; profile is durably saved with revision CAS',async()=>{
  const {runner,calls}=fixture();await runner.unlock(key);
  assert.equal(calls.find(x=>x.operation==='session.open').input.recoveryKey,key);
  assert.ok(calls.filter(x=>x.type==='api').every(x=>!JSON.stringify(x).includes(key)));
  const saves=calls.filter(x=>x.method==='PUT');assert.equal(saves[0].body.profileRevision,null);assert.equal(saves[1].body.profileRevision,'1');
});
test('grant handoff clears hosted cookie only after import and profile persistence',async()=>{
  const {runner,calls}=fixture();await runner.unlock(key);await runner.importConnection('supabase','source');
  const final=calls.findIndex(x=>x.body?.action==='complete-bridge');
  assert.ok(final>0);assert.equal(calls[final-1].method,'PUT');assert.equal(calls[final].body.bridgeId,'bridge-id');
});
test('profile persistence failure blocks key acknowledgement and further grant handoff',async()=>{
  const {runner,calls}=fixture({saveFails:true});await assert.rejects(runner.unlock(key),/profile_changed/);
  assert.ok(!calls.some(x=>x.operation==='key.acknowledge'));assert.ok(!calls.some(x=>x.body?.action==='complete-bridge'));
});
test('arbitrary release controller is rejected before key material is submitted',async()=>{
  const {runner,calls}=fixture({controller:'https://attacker.example'});await assert.rejects(runner.unlock(key),/release policy/);assert.ok(!calls.some(x=>x.type==='command'));
});
test('unsupported individual-object and DDL selection cannot silently broaden capture',()=>{
  const workspace={selection:{source:'source',sources:['source']},databases:[{projectRef:'source',tables:[{name:'public.t',objectType:'TABLE',mode:'structure_and_data'},{name:'public.v',objectType:'VIEW',mode:'structure_and_data'}],binaries:[{name:'a',bucket:'images',mode:'include'}]}]};
  assert.deepEqual(managedScope(workspace),{tables:['public.t'],buckets:['images'],auth:true,functions:true});
  workspace.databases[0].binaries.push({name:'b',bucket:'images',mode:'exclude'});assert.throws(()=>managedScope(workspace),/complete Storage buckets/);
  workspace.databases[0].binaries=[];workspace.databases[0].tables[1].mode='exclude';assert.throws(()=>managedScope(workspace),/complete database schema/);
});
test('attestation download cannot manufacture evidence; generated key is 32 bytes',()=>{
  assert.throws(()=>evidenceReport({}),/No verified attestation/);
  const generated=newRecoveryKey();assert.match(generated,/^[A-Za-z0-9_-]{43}$/);assert.equal(Buffer.from(generated,'base64url').length,32);
  assert.equal(evidenceReport({verifiedAt:'now',imageDigest:policy.imageDigest,attestationToken:'signed-google-token'}).attestationToken,'signed-google-token');
});
