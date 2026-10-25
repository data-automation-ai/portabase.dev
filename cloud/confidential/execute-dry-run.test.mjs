import test from 'node:test';
import assert from 'node:assert/strict';
import {executeDryRun} from './execute-dry-run.mjs';

const sourceRef='a'.repeat(20),targetRef='b'.repeat(20);
test('drill uses selected projects and requires a blank destination before capture',async()=>{
  const calls=[],status={};
  const command=async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='preflight')return {ready:true,source:{ref:sourceRef},target:{ref:targetRef,blank:true}};
    if(operation==='backup.start')return {id:'capture'};
    if(operation==='restore.start')return {id:'restore'};
    if(operation==='job.status')return input.id==='capture'
      ? {state:'complete',result:{captureComplete:true}}
      : {state:'complete',result:{restoreVerified:true}};
  };
  await executeDryRun({command,status,persist:async()=>{},sourceRef,targetRef});
  assert.equal(status.state,'recovery_data_path_verified');
  assert.equal(calls.find(call=>call.operation==='restore.start').input.confirmTarget,targetRef);
  const blocked=[],badStatus={};
  await executeDryRun({command:async(operation)=>{
    blocked.push(operation);return {ready:false,source:{ref:sourceRef},target:{ref:targetRef,blank:false}};
  },status:badStatus,persist:async()=>{},sourceRef,targetRef});
  assert.equal(badStatus.state,'drill_failed');
  assert.deepEqual(blocked,['preflight']);
});

test('Dropbox trial stops before restore if remote capsule is not verified',async()=>{
  const calls=[],status={};
  await executeDryRun({command:async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='preflight')return {ready:true,source:{ref:sourceRef},target:{ref:targetRef,blank:true}};
    if(operation==='backup.start')return {id:'capture'};
    if(operation==='job.status')return {state:'complete',result:{captureComplete:true,destinationKind:'dropbox',vaultVerified:false}};
  },status,persist:async()=>{},sourceRef,targetRef,vault:'dropbox'});
  assert.equal(calls.find(call=>call.operation==='backup.start').input.vault,'dropbox');
  assert.equal(calls.some(call=>call.operation==='restore.start'),false);
  assert.equal(status.state,'drill_failed');
});
