import test from 'node:test';
import assert from 'node:assert/strict';
import {runnerUsage} from './runner-usage.mjs';
import {runnerName,beaconRunnerName} from './compute-control.mjs';
const owner='a'.repeat(64),now=Date.parse('2026-10-28T12:00:00Z');
const series=(name,points,id='1')=>({metric:{type:'compute.googleapis.com/instance/uptime',labels:{instance_name:name}},metricKind:'DELTA',resource:{type:'gce_instance',labels:{project_id:'portabase-dev',zone:'us-central1-a',instance_id:id}},points});
const point=(from,to,value)=>({interval:{startTime:new Date(from).toISOString(),endTime:new Date(to).toISOString()},value:{doubleValue:value}});
test('authoritative uptime sums deleted/recreated VMs, separates beacons and deduplicates pages',async()=>{
  const p=point(now-120000,now-60000,60),calls=[];
  const usage=runnerUsage({now:()=>now,token:async()=>'fixture',fetchImpl:async url=>{calls.push(url);return Response.json(calls.length===1?{timeSeries:[series(runnerName(owner),[p])],nextPageToken:'next'}:{timeSeries:[series(runnerName(owner),[p]),series(beaconRunnerName(owner),[p],'2')]});}});
  const result=await usage(owner);
  assert.equal(result.runnerRuntimeMs,120000);assert.equal(result.beaconRuntimeMs,60000);assert.equal(result.samples,2);
  assert.match(new URL(calls[0]).searchParams.get('filter'),new RegExp(runnerName(owner)));
  assert.equal(result.reportingDelaySeconds,300);
});
test('uptime cannot be queried for foreign series; errors and absent samples stay distinct',async()=>{
  const read=payload=>runnerUsage({now:()=>now,token:async()=>'fixture',fetchImpl:async()=>Response.json(payload)});
  await assert.rejects(read({timeSeries:[series('other',[])]})(owner),/identity_mismatch/);
  assert.equal((await read({})(owner)).status,'no_samples');
  await assert.rejects(runnerUsage({now:()=>now,token:async()=>'fixture',fetchImpl:async()=>new Response('',{status:403})})(owner),/unavailable/);
  await assert.rejects(read({})(owner,{windowStart:new Date(now-31*86400000).toISOString()}),/window/);
});
test('partial window samples are not claimed as exact measured runtime',async()=>{
  const start=now-3600000;
  const read=runnerUsage({now:()=>now,token:async()=>'fixture',fetchImpl:async()=>Response.json({timeSeries:[series(runnerName(owner),[point(start-30000,start+30000,60),point(start+30000,start+90000,60)])]})});
  const result=await read(owner,{windowStart:new Date(start).toISOString()});
  assert.equal(result.runnerRuntimeMs,60000);assert.equal(result.boundarySamplesExcluded,1);
});
