import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {confidentialAdmission} from '../netlify/functions/cloud-confidential-admission.mjs';
const user={id:'confirmed-customer',cloudVersion:'supabase',emailVerified:true};
const event=(operation='backup.start',requestId=randomUUID())=>({httpMethod:'POST',body:JSON.stringify({operation,requestId})});
function fixture(overrides={}) {
  let at=Date.now(),entry=null,revision=0;
  const database=()=>({
    getWithMetadata:async()=>entry?structuredClone(entry):null,
    setJSON:async(key,data,condition)=>{
      if(condition.onlyIfNew?entry!==null:condition.onlyIfMatch!==entry?.etag)return {modified:false};
      entry={data,etag:String(++revision)};return {modified:true};
    },
  });
  return {run:confidentialAdmission({authenticate:async()=>user,subscription:async()=>null,database,clock:()=>at,...overrides}),
    advance:ms=>{at+=ms;}};
}
test('free confirmed customer gets one 10 GiB manual backup, then another after 24 hours',async()=>{
  const {run,advance}=fixture();const first=await run(event());
  assert.equal(first.statusCode,200);assert.equal(JSON.parse(first.body).maxBytes,10*1024**3);
  assert.equal((await run(event())).statusCode,429);
  advance(86400001);assert.equal((await run(event())).statusCode,200);
});
test('explicit validation cap applies to one verified owner without changing public free limits',async()=>{
  const options={validationOwnerId:user.id,validationMaxBytes:String(16*1024**3)};
  const allowed=await fixture(options).run(event('quota.inspect'));
  assert.equal(JSON.parse(allowed.body).maxBytes,16*1024**3);
  const other=await fixture({...options,authenticate:async()=>({...user,id:'another-customer'})}).run(event('quota.inspect'));
  assert.equal(JSON.parse(other.body).maxBytes,10*1024**3);
  for(const invalid of ['0','oops',String(26*1024**3)]){
    const response=await fixture({...options,validationMaxBytes:invalid}).run(event('quota.inspect'));
    assert.equal(JSON.parse(response.body).maxBytes,10*1024**3);
  }
});
test('concurrent free submissions cannot reserve two backups',async()=>{
  const {run}=fixture();const results=await Promise.all([run(event()),run(event()),run(event())]);
  assert.equal(results.filter(r=>r.statusCode===200).length,1);
  assert.equal(results.filter(r=>r.statusCode===429).length,2);
});
test('quota inspections and restore do not consume the manual capture allowance; duplicates are rejected',async()=>{
  const {run}=fixture();const request=event();
  assert.equal((await run(event('quota.inspect'))).statusCode,200);
  assert.equal((await run(event('restore.start'))).statusCode,200);
  assert.equal((await run(request)).statusCode,200);
  assert.equal((await run(request)).statusCode,409);
});
test('unverified users and malformed payloads are denied',async()=>{
  assert.equal((await fixture({authenticate:async()=>({...user,emailVerified:false})}).run(event())).statusCode,403);
  for(const body of ['null','[]','{}'])assert.equal((await fixture().run({httpMethod:'POST',body})).statusCode,400);
});
test('persistent quota storage failure blocks execution',async()=>{
  const {run}=fixture({database:()=>{throw new Error('private storage details');}});
  const result=await run(event());assert.equal(result.statusCode,503);
  assert.equal(JSON.parse(result.body).error,'quota_service_unavailable');
});
test('runner allocations have a separate daily limit and cannot be replayed',async()=>{
  const {run}=fixture(),start=event('runner.start');
  assert.equal((await run(start)).statusCode,200);
  assert.equal((await run(start)).statusCode,409);
  assert.equal((await run(event('runner.start'))).statusCode,429);
  assert.equal((await run(event())).statusCode,200);
});
test('isolated validation owner may restart a failed runner without changing public allowance',async()=>{
  const {run}=fixture({validationOwnerId:user.id,validationMaxBytes:String(25*1024**3)});
  for(let i=0;i<3;i++)assert.equal((await run(event('runner.start'))).statusCode,200);
  assert.equal((await run(event('runner.start'))).statusCode,429);
  assert.equal((await run(event())).statusCode,200);
  assert.equal((await run(event())).statusCode,429);
  const other=fixture({validationOwnerId:'other',validationMaxBytes:String(25*1024**3)});
  assert.equal((await other.run(event('runner.start'))).statusCode,200);
  assert.equal((await other.run(event('runner.start'))).statusCode,429);
});
