import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerServer,controllerCustomerPolicy} from './controller.mjs';
import {instanceConfiguration,runnerName,computeControl} from './compute-control.mjs';
const owner='a'.repeat(64),image=`us-central1-docker.pkg.dev/portabase-dev/portabase-confidential/application@sha256:${'b'.repeat(64)}`;
test('public customer mode requires explicit operator flag; default validation fails closed',()=>{
  assert.throws(()=>controllerCustomerPolicy({}),/validation_customers_required/);
  assert.throws(()=>controllerCustomerPolicy({PORTABASE_CUSTOMER_MODE:'true'}),/invalid_customer_mode/);
  const id='11111111-1111-1111-1111-111111111111';
  assert.deepEqual([...controllerCustomerPolicy({VALIDATION_CUSTOMERS:id})],[id]);
  assert.equal(controllerCustomerPolicy({PORTABASE_CUSTOMER_MODE:'public'}),undefined);
});
test('compute config requires an immutable image and bounds the hardware lifecycle',()=>{
  assert.throws(()=>instanceConfiguration(owner,image.replace(/@sha256:.*/,':latest')),/immutable/);
  const config=instanceConfiguration(owner,image);
  assert.equal(config.confidentialInstanceConfig.confidentialInstanceType,'TDX');
  assert.equal(config.shieldedInstanceConfig.enableSecureBoot,true);
  assert.equal(config.scheduling.instanceTerminationAction,'DELETE');
  assert.equal(config.scheduling.maxRunDuration.seconds,'14400');
  assert.equal(config.disks[0].autoDelete,true);
  assert.ok(config.metadata.items.some(x=>x.key==='tee-restart-policy'&&x.value==='Never'));
});
test('compute discovery rejects a substituted customer or an arbitrary proxy address',async()=>{
  const value={name:runnerName(owner),labels:{customer:owner.slice(0,40)},confidentialInstanceConfig:{confidentialInstanceType:'TDX'},
    networkInterfaces:[{networkIP:'169.254.169.254'}],creationTimestamp:new Date().toISOString()};
  const compute=computeControl({image,token:async()=>'fixture',fetchImpl:async()=>Response.json(value)});
  await assert.rejects(compute.get(owner),/invalid_runner_address/);
  value.networkInterfaces[0].networkIP='10.98.0.5';value.labels.customer='other';
  await assert.rejects(compute.get(owner),/runner_identity_mismatch/);
  value.labels.customer=owner.slice(0,40);
  const found=await compute.get(owner);
  assert.equal(Date.parse(found.expiresAt)-Date.parse(found.createdAt),4*60*60*1000);
});
async function serve(t,options) {
  const server=controllerServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
  return (path,body,headers={})=>fetch(`http://127.0.0.1:${server.address().port}${path}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});
}
test('unauthenticated and cross-origin requests cannot query or allocate compute',async t=>{
  let queries=0;const call=await serve(t,{authenticate:async()=>{throw new Error('no');},compute:{get:async()=>{queries++;}}});
  assert.equal((await call('/session',{})).status,401);
  assert.equal((await call('/session',{}, {origin:'https://attacker.example'})).status,403);assert.equal(queries,0);
});
test('only ciphertext is relayed; private upstream properties are dropped',async t=>{
  let sent;
  const call=await serve(t,{authenticate:async()=>({id:'fixture',owner}),compute:{get:async()=>({address:'10.98.0.5',status:'RUNNING'})},
    fetchImpl:async(url,options)=>{sent={url,body:JSON.parse(options.body)};return Response.json({envelope:'ciphertext-reply',debugSecret:'must-not-forward'});}});
  assert.equal((await call('/command',{envelope:'ciphertext',sessionId:'fixture',password:'should-never-be-plaintext'})).status,400);
  const response=await call('/command',{envelope:'ciphertext',sessionId:'fixture'});
  assert.equal(response.status,200);assert.deepEqual(await response.json(),{envelope:'ciphertext-reply'});
  assert.equal(sent.url,'http://10.98.0.5:8080/command');
});
test('a denied compute allowance never creates an instance',async t=>{
  let creates=0;const call=await serve(t,{authenticate:async()=>({id:'fixture',owner}),compute:{get:async()=>null,create:async()=>{creates++;}},admit:async()=>{throw new Error('quota');}});
  assert.equal((await call('/session',{requestId:crypto.randomUUID()})).status,503);assert.equal(creates,0);
});

test('usage uses authenticated owner only and cannot allocate compute',async t=>{
  let called;
  const call=await serve(t,{authenticate:async()=>({id:'fixture',owner}),compute:{get:async()=>assert.fail('usage must not allocate or inspect compute')},
    usage:async(o,options)=>{called={o,options};return {runnerRuntimeMs:60000,source:'google_compute_uptime'};}});
  assert.equal((await call('/usage',{owner:'other'})).status,400);
  assert.equal((await call('/usage',{windowStart:'2026-10-28T00:00:00Z'})).status,200);
  assert.equal(called.o,owner);assert.equal(called.options.windowStart,'2026-10-28T00:00:00Z');
});

test('scheduled beacon route requires separate scheduler identity and feature enablement',async t=>{
  let calls=0;
  const invoke=await serve(t,{scheduledBeacons:true,authenticateScheduler:async h=>{if(h!=='Bearer scheduler')throw Error('deny');},dispatchBeacons:async()=>{calls++;return {started:1};}});
  assert.equal((await invoke('/beacon/tick',{})).status,401);assert.equal(calls,0);
  assert.equal((await invoke('/beacon/tick',{}, {Authorization:'Bearer scheduler'})).status,200);assert.equal(calls,1);
  const disabled=await serve(t,{scheduledBeacons:false,dispatchBeacons:async()=>assert.fail('must not launch')});
  assert.equal((await disabled('/beacon/tick',{})).status,503);
});
