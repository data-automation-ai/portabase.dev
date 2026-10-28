import test from 'node:test';
import assert from 'node:assert/strict';
import {transferView,sourceReadMeter,destinationWriteMeter} from './machine-visual.mjs';
test('phase estimates never become measured capsule fill',()=>{
  const state={executing:true,backup:{state:'running',phase:'transfer',estimatedPercent:96}};
  assert.equal(transferView(state).percent,null);
  assert.equal(transferView(state).vaultActive,true);
  assert.equal(transferView(state).sourceActive,false);
  state.backup.delivery={bytesReceived:50,totalBytes:100};
  assert.equal(transferView(state).percent,50);
  state.backup.delivery.bytesReceived=100;
  assert.equal(transferView(state).percent,99);
  state.backup.state='complete';state.backup.result={vaultVerified:true};
  assert.equal(transferView(state).percent,100);
});
test('failed, paused and idle jobs never show moving transfer pulses',()=>{
  const state={executing:true,backup:{state:'running',phase:'storage'},restore:{state:'running'}};
  assert.equal(transferView(state).sourceActive,true);
  for(const changed of [{error:'provider_failed'},{state:'paused'},{executing:false}]){
    const view=transferView({...state,...changed});
    assert.equal(view.sourceActive,false);assert.equal(view.targetActive,false);assert.equal(view.vaultActive,false);
  }
});
test('source and destination meters do not show 100% while job is still running',()=>{
  const runningBackup={executing:true,backupExecuted:true,backup:{state:'running',phase:'database',estimatedPercent:5}};
  assert.doesNotMatch(sourceReadMeter(runningBackup),/100% read/);
  assert.match(sourceReadMeter(runningBackup),/Reading database/);
  const runningRestore={executing:true,restoreExecuted:true,restore:{state:'running',phase:'data'}};
  assert.doesNotMatch(destinationWriteMeter(runningRestore),/100% written/);
  assert.match(destinationWriteMeter(runningRestore),/Writing data/);
});
