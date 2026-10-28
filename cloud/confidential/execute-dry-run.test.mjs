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

test('allowOverwrite allows occupied target and passes flag to engine',async()=>{
  const calls=[],status={};
  const command=async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='preflight')return {ready:false,source:{ref:sourceRef},target:{ref:targetRef,blank:false}};
    if(operation==='backup.start')return {id:'capture'};
    if(operation==='restore.start')return {id:'restore'};
    if(operation==='job.status')return input.id==='capture'
      ? {state:'complete',result:{captureComplete:true}}
      : {state:'complete',result:{restoreVerified:true}};
  };
  await executeDryRun({command,status,persist:async()=>{},sourceRef,targetRef,allowOverwrite:true});
  assert.equal(status.state,'recovery_data_path_verified');
  const backupStart=calls.find(call=>call.operation==='backup.start');
  assert.equal(backupStart.input.allowOverwrite,true);
  const restoreStart=calls.find(call=>call.operation==='restore.start');
  assert.equal(restoreStart.input.allowOverwrite,true);
});

test('Mode 1 (dropbox) executes capture to dropbox and restores to destination',async()=>{
  const calls=[],status={};
  const command=async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='preflight')return {ready:true,source:{ref:sourceRef},target:{ref:targetRef,blank:true}};
    if(operation==='backup.start')return {id:'capture'};
    if(operation==='restore.start')return {id:'restore'};
    if(operation==='job.status')return input.id==='capture'
      ? {state:'complete',result:{captureComplete:true,destinationKind:'dropbox',vaultVerified:true}}
      : {state:'complete',result:{restoreVerified:true}};
  };
  await executeDryRun({command,status,persist:async()=>{},sourceRef,targetRef,mode:'dropbox'});
  assert.equal(status.state,'recovery_data_path_verified');
  assert.equal(calls.find(c=>c.operation==='backup.start').input.vault,'dropbox');
  assert.equal(calls.find(c=>c.operation==='restore.start').input.confirmTarget,targetRef);
});

test('Mode 3 (capsule_only) captures to dropbox, verifies upload, and skips restore',async()=>{
  const calls=[],status={};
  const command=async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='preflight')return {ready:true,source:{ref:sourceRef}};
    if(operation==='backup.start')return {id:'capture'};
    if(operation==='job.status')return {state:'complete',result:{captureComplete:true,destinationKind:'dropbox',vaultVerified:true}};
  };
  await executeDryRun({command,status,persist:async()=>{},sourceRef,targetRef:undefined,mode:'capsule_only'});
  assert.equal(status.state,'capsule_delivered');
  assert.equal(calls.find(c=>c.operation==='backup.start').input.vault,'capsule_only');
  assert.equal(calls.some(c=>c.operation==='restore.start'),false);
});

test('S3 drill separates backup mode from provider for single, capsule-only, and batch runs',async()=>{
  for(const variant of ['single','capsule','batch']){
    const calls=[],status={};
    const mode=variant==='capsule'?'capsule_only':'dropbox';
    const command=async(operation,input)=>{
      calls.push({operation,input});
      if(operation==='preflight')return {ready:true,source:{ref:sourceRef},target:{ref:targetRef,blank:true}};
      if(operation==='backup.start'){
        assert.equal(input.vault,mode);assert.equal(input.vaultProvider,'s3');return {id:'capture'};
      }
      if(operation==='restore.start')return {id:'restore'};
      if(operation==='job.status')return {state:'complete',result:{captureComplete:true,vaultVerified:true,destinationKind:'s3',restoreVerified:true}};
      return {};
    };
    await executeDryRun({command,status,persist:async()=>{},sourceRef,targetRef,mode,vaultProvider:'s3',
      ...(variant==='batch'?{sourceRefs:[sourceRef,'other-fixture-source'],targetMap:{[sourceRef]:targetRef,'other-fixture-source':targetRef}}:{})});
    assert.equal(status.state,variant==='capsule'?'capsule_delivered':'recovery_data_path_verified');
    assert.equal(calls.filter(c=>c.operation==='backup.start').length,variant==='batch'?2:1);
  }
});

test('Mode 4 (restore_only) skips capture and restores specified capsule into destination',async()=>{
  const calls=[],status={};
  const chosenCapsuleId='ekklokrukxmqlahtonnc-2026-10-27T08-18-22.962Z';
  const command=async(operation,input)=>{
    calls.push({operation,input});
    if(operation==='preflight')return {ready:true,target:{ref:targetRef,blank:true}};
    if(operation==='restore.start')return {id:'restore'};
    if(operation==='job.status')return {state:'complete',result:{restoreVerified:true}};
  };
  await executeDryRun({command,status,persist:async()=>{},sourceRef:undefined,targetRef,mode:'restore_only',dropboxCapsuleId:chosenCapsuleId});
  assert.equal(status.state,'recovery_data_path_verified');
  assert.equal(calls.some(c=>c.operation==='backup.start'),false);
  const restoreCall=calls.find(c=>c.operation==='restore.start');
  assert.equal(restoreCall.input.capsuleId,chosenCapsuleId);
  assert.equal(restoreCall.input.confirmTarget,targetRef);
});

test('Multi-Project Batch: sequential capture and optional 1-to-1 restore across multiple source projects', async () => {
  const calls = [], status = {};
  const sourceRefs = ['proj-alpha-123', 'proj-beta-456'];
  const targetMap = { 'proj-alpha-123': 'target-alpha', 'proj-beta-456': 'target-beta' };

  const command = async (operation, input) => {
    calls.push({ operation, input });
    if (operation === 'preflight') return { ready: true, source: { ref: sourceRefs[0] }, target: { ref: 'target-alpha', blank: true } };
    if (operation === 'project.select') return { ok: true, ref: input.ref };
    if (operation === 'backup.start') return { id: 'capture-' + calls.filter(c => c.operation === 'backup.start').length };
    if (operation === 'restore.start') return { id: 'restore-' + calls.filter(c => c.operation === 'restore.start').length };
    if (operation === 'job.status') {
      return { state: 'complete', result: { captureComplete: true, vaultVerified: true, restoreVerified: true, capsuleId: 'capsule-id' } };
    }
  };

  await executeDryRun({
    command, status, persist: async () => {},
    sourceRef: sourceRefs[0], targetRef: 'target-alpha',
    mode: 'dropbox',
    sourceRefs, targetMap,
  });

  assert.equal(status.state, 'recovery_data_path_verified');
  assert.equal(status.backupExecuted, true);
  assert.equal(status.restoreExecuted, true);
  assert.equal(status.batchProgress.total, 2);
  assert.equal(status.batchProgress.completedCapsules.length, 2);

  const selectSourceCalls = calls.filter(c => c.operation === 'project.select' && c.input.slot === 'source');
  assert.equal(selectSourceCalls.length, 2);
  assert.equal(selectSourceCalls[0].input.ref, 'proj-alpha-123');
  assert.equal(selectSourceCalls[1].input.ref, 'proj-beta-456');

  const backupCalls = calls.filter(c => c.operation === 'backup.start');
  assert.equal(backupCalls.length, 2);

  const restoreCalls = calls.filter(c => c.operation === 'restore.start');
  assert.equal(restoreCalls.length, 2);
  assert.equal(restoreCalls[0].input.confirmTarget, 'target-alpha');
  assert.equal(restoreCalls[1].input.confirmTarget, 'target-beta');
});
