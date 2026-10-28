import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyUsage,usageSummary,USAGE_PERIOD_MS,MAX_USAGE_LEASE_MS } from '../netlify/shared/confidential-usage.mjs';
import { createConfidentialUsageHandler } from '../netlify/functions/cloud-confidential-usage.mjs';
import { CLOUD_PLANS } from '../netlify/shared/product.mjs';
const plan=CLOUD_PLANS['cloud-9'], now=Date.parse('2026-10-28T00:00:00Z');
function db(){let current=null,revision=0;return {
  getWithMetadata:async()=>current?structuredClone(current):null,
  setJSON:async(_key,data,condition)=>{if(condition.onlyIfNew?current!==null:condition.onlyIfMatch!==current?.etag)return {modified:false};current={data:structuredClone(data),etag:String(++revision)};return {modified:true};},
  data:()=>current?.data,
};}
const reserve=(overrides={})=>({operation:'reserve',requestId:randomUUID(),projectRef:'a'.repeat(20),kind:'backup',binaryMode:'incremental',databaseBytes:0,binaryBytes:0,otherBytes:0,...overrides});
const finish=(r,overrides={})=>({...r,operation:'finish',status:'succeeded',durationMs:60000,completeness:'complete',verified:true,manifestVerified:true,...overrides});

test('initial binaries are paid by Portabase once, while database and other bytes remain charged',async()=>{
  const store=db(),r=reserve({binaryMode:'baseline',binaryBytes:12_000_000_000,databaseBytes:100_000_000,otherBytes:100});
  await applyUsage(store,'owner',r,{now,plan});
  let usage=await applyUsage(store,'owner',finish(r),{now:now+60000,plan});
  assert.equal(usage.chargedBytes,100_000_100);assert.equal(usage.baselineBytes,12_000_000_000);
  assert.equal(usage.jobRuntimeMs,60000);assert.equal(usage.runnerRuntimeMs,null);
  assert.equal(usage.succeeded,1);assert.equal(usage.lastBackup.verified,true);
  await assert.rejects(applyUsage(store,'owner',reserve({binaryMode:'baseline',binaryBytes:1}),{now,plan}),/incremental_binary_required/);
  await assert.rejects(applyUsage(store,'owner',reserve({projectRef:'b'.repeat(20)}),{now,plan}),/plan_project_limit/);
});
test('parallel reservations cannot oversubscribe the shared 10 GB allowance',async()=>{
  const store=db(),r1=reserve({databaseBytes:6_000_000_000}),r2=reserve({binaryBytes:6_000_000_000});
  const results=await Promise.allSettled([applyUsage(store,'owner',r1,{now,plan}),applyUsage(store,'owner',r2,{now,plan})]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.code,'transfer_allowance_exceeded');
});
test('reservations grow monotonically, exact completion is idempotent, failures consume actual bytes',async()=>{
  const store=db(),r=reserve({databaseBytes:500});
  await applyUsage(store,'owner',r,{now,plan});
  await applyUsage(store,'owner',{...r,databaseBytes:200},{now,plan});
  assert.equal(usageSummary(store.data(),{now}).reservedBytes,500);
  const receipt=finish(r,{databaseBytes:300,status:'failed',verified:false,manifestVerified:false,completeness:'unverified'});
  await applyUsage(store,'owner',receipt,{now,plan});await applyUsage(store,'owner',receipt,{now,plan});
  assert.equal(usageSummary(store.data(),{now}).chargedBytes,300);
  assert.equal(usageSummary(store.data(),{now}).failed,1);
  await assert.rejects(applyUsage(store,'owner',{...receipt,databaseBytes:100},{now,plan}),/usage_receipt_conflict/);
});
test('excess completion and finish without reservation fail closed',async()=>{
  const store=db(),r=reserve({otherBytes:100});
  await assert.rejects(applyUsage(store,'owner',finish(r),{now,plan}),/usage_reservation_required/);
  await applyUsage(store,'owner',r,{now,plan});
  await assert.rejects(applyUsage(store,'owner',finish(r,{otherBytes:101}),{now,plan}),/usage_exceeds_reservation/);
});
test('fixed 30-day windows reset allowance but never reset baseline or project binding',async()=>{
  const store=db(),r=reserve({binaryMode:'baseline',binaryBytes:500,databaseBytes:10_000_000_000});
  await applyUsage(store,'owner',r,{now,plan});await applyUsage(store,'owner',finish(r),{now,plan});
  const next=now+USAGE_PERIOD_MS;
  const usage=await applyUsage(store,'owner',reserve({databaseBytes:10_000_000_000}),{now:next,plan});
  assert.equal(usage.chargedBytes,0);assert.equal(usage.reservedBytes,10_000_000_000);
  assert.equal(usage.periodStart,new Date(next).toISOString());
  await assert.rejects(applyUsage(store,'owner',reserve({binaryMode:'baseline'}),{now:next,plan}),/incremental_binary_required/);
});
test('free beacons remain separate and cannot declare exempt binary transfers',async()=>{
  const store=db(),r=reserve({kind:'beacon',binaryMode:'none',projectRef:'b'.repeat(20),otherBytes:512});
  await applyUsage(store,'owner',r,{now,plan});
  const usage=await applyUsage(store,'owner',finish(r,{verified:false,manifestVerified:false,completeness:'unverified'}),{now,plan});
  assert.equal(usage.beaconBytes,512);assert.equal(usage.chargedBytes,0);assert.equal(usage.succeeded,0);assert.equal(usage.beaconSucceeded,1);
  await assert.rejects(applyUsage(store,'owner',{...r,binaryBytes:1},{now,plan}),/invalid_beacon_usage/);
});
test('customer authorization alone cannot forge a usage receipt; account is server-owned',async()=>{
  const store=db(),command=reserve();let writes=0,challenge;
  const base={authenticate:async()=>({id:'alice',cloudVersion:'supabase',emailVerified:true}),subscription:async()=>null,
    database:()=>({...store,setJSON:async(...args)=>{writes++;return store.setJSON(...args);}}),imageDigest:'sha256:'+'a'.repeat(64),clock:()=>now};
  const event={httpMethod:'POST',body:JSON.stringify({command,offer:{attestation:'forged'}})};
  const reject=createConfidentialUsageHandler({...base,verify:async()=>{throw Error('bad signature');}});
  assert.equal((await reject(event)).statusCode,403);assert.equal(writes,0);
  const allow=createConfidentialUsageHandler({...base,verify:async(_offer,c)=>{challenge=c;}});
  assert.equal((await allow(event)).statusCode,200);assert.match(challenge,/^[A-Za-z0-9_-]{43}$/);
  assert.equal((await allow({...event,body:JSON.stringify({command:{...command,customerId:'other'},offer:{}})})).statusCode,400);
});


test('failed initial baseline resumes without resetting spent bytes and concurrent retries cannot both claim it',async()=>{
  const store=db(),first=reserve({binaryMode:'baseline',binaryBytes:500,databaseBytes:100});
  await applyUsage(store,'owner',first,{now,plan});
  await applyUsage(store,'owner',finish(first,{status:'failed',verified:false,manifestVerified:false,completeness:'unverified'}),{now,plan});
  assert.equal(usageSummary(store.data(),{now}).initialBinarySnapshotAvailable,true);
  const retries=[reserve({binaryMode:'baseline',binaryBytes:200,databaseBytes:100}),reserve({binaryMode:'baseline',binaryBytes:200,databaseBytes:100})];
  const results=await Promise.allSettled(retries.map(r=>applyUsage(store,'owner',r,{now,plan})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const winner=retries[results.findIndex(r=>r.status==='fulfilled')];
  const final=await applyUsage(store,'owner',finish(winner),{now,plan});
  assert.equal(final.baselineBytes,700);assert.equal(final.chargedBytes,200);
  assert.equal(final.initialBinarySnapshotAvailable,false);
  await assert.rejects(applyUsage(store,'owner',reserve({binaryMode:'baseline'}),{now,plan}),/incremental_binary_required/);
});

test('restores use the bound source project and charge all restored bytes',async()=>{
  const store=db(),first=reserve({binaryMode:'baseline',binaryBytes:500});
  await applyUsage(store,'owner',first,{now,plan});await applyUsage(store,'owner',finish(first),{now,plan});
  const restore=reserve({kind:'restore',binaryMode:'none',databaseBytes:100,binaryBytes:500});
  await applyUsage(store,'owner',restore,{now,plan});
  const usage=await applyUsage(store,'owner',finish(restore),{now,plan});
  assert.equal(usage.chargedBytes,600);
  await assert.rejects(applyUsage(store,'owner',reserve({kind:'restore',binaryMode:'none',projectRef:'b'.repeat(20)}),{now,plan}),/plan_project_limit/);
});

test('missing approved image blocks receipts even with authenticated customer',async()=>{
  const handler=createConfidentialUsageHandler({authenticate:async()=>({id:'alice',cloudVersion:'supabase',emailVerified:true}),subscription:async()=>null,database:db,imageDigest:'',configuration:async()=>({})});
  const result=await handler({httpMethod:'POST',body:JSON.stringify({command:reserve(),offer:{}})});
  assert.equal(result.statusCode,503);assert.equal(JSON.parse(result.body).error,'usage_attestation_not_configured');
});


test('attested abort charges all reservations and allows the failed initial baseline to continue',async()=>{
 const store=db(),r=reserve({binaryMode:'baseline',binaryBytes:500,databaseBytes:100});
 await applyUsage(store,'owner',r,{now,plan});
 const aborted=await applyUsage(store,'owner',{...r,operation:'abort',binaryBytes:0,databaseBytes:0},{now:now+1000,plan});
 assert.equal(aborted.chargedBytes,100);assert.equal(aborted.baselineBytes,500);assert.equal(aborted.failed,1);
 assert.equal(aborted.initialBinarySnapshotAvailable,true);assert.equal(aborted.outboundBytes,null);assert.equal(aborted.lastBackup.outboundBytes,null);assert.equal(aborted.estimatedOutboundBytes,600);
 assert.equal((await applyUsage(store,'owner',{...r,operation:'abort'},{now:now+2000,plan})).chargedBytes,100);
 await assert.rejects(applyUsage(store,'owner',finish(r),{now:now+2000,plan}),/usage_receipt_conflict/);
});

test('orphaned reservations expire after the enforced VM lifetime and never accept late writes',async()=>{
 const store=db(),r=reserve({binaryMode:'baseline',binaryBytes:500,databaseBytes:100});
 await applyUsage(store,'owner',r,{now,plan});
 const expiredAt=now+MAX_USAGE_LEASE_MS;
 const summary=usageSummary(store.data(),{now:expiredAt});
 assert.equal(summary.failed,1);assert.equal(summary.chargedBytes,100);assert.equal(summary.initialBinarySnapshotAvailable,true);
 await assert.rejects(applyUsage(store,'owner',{...r,databaseBytes:200},{now:expiredAt,plan}),/usage_job_finished/);
 await applyUsage(store,'owner',reserve({binaryMode:'baseline',binaryBytes:400}),{now:expiredAt,plan});
 assert.equal(usageSummary(store.data(),{now:expiredAt}).failed,1);
});
