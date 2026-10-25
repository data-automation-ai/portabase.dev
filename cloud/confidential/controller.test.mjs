import test from 'node:test';
import assert from 'node:assert/strict';
import {controllerServer} from './controller.mjs';
import {instanceConfiguration,runnerName,computeControl} from './compute-control.mjs';
const owner='a'.repeat(64),image=`us-central1-docker.pkg.dev/portabase-dev/portabase-confidential/application@sha256:${'b'.repeat(64)}`;
test('compute config requires an immutable image and bounds the hardware lifecycle',()=>{
  assert.throws(()=>instanceConfiguration(owner,image.replace(/@sha256:.*/,':latest')),/immutable/);
  const config=instanceConfiguration(owner,image);
  assert.equal(config.confidentialInstanceConfig.confidentialInstanceType,'TDX');
  assert.equal(config.shieldedInstanceConfig.enableSecureBoot,true);
  assert.equal(config.scheduling.instanceTerminationAction,'DELETE');
  assert.equal(config.scheduling.maxRunDuration.seconds,'7200');
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
