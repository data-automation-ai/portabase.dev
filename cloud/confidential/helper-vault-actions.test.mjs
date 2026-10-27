import test from 'node:test';
import assert from 'node:assert/strict';
import {handleVaultAction} from './helper-vault-actions.mjs';
test('Dropbox selection invokes its own command and opens OAuth only when disconnected',async()=>{
  const calls=[];const status={connections:{dropbox:false},error:'previous_error'};
  const args={pathname:'/vault-provider',form:new URLSearchParams({provider:'dropbox'}),status,
    command:async(op,input)=>{calls.push({op,input});return {connected:true};},beginDropbox:async()=>calls.push('oauth'),persist:async()=>{}};
  assert.equal(await handleVaultAction(args),true);
  assert.deepEqual(calls,['oauth']);
  assert.equal(status.error,undefined);
  status.connections.dropbox=true;calls.length=0;await handleVaultAction(args);
  assert.deepEqual(calls,[{op:'vault.check',input:undefined}]);assert.equal(status.activeVault,'dropbox');
});
test('S3 saves only public connection metadata after confirmation',async()=>{
  const status={connections:{}};const form=new URLSearchParams({bucket:'test',accessKeyId:'fixture-id',secretAccessKey:'fixture-secret'});
  await handleVaultAction({pathname:'/s3',form,status,command:async(op)=>{assert.equal(op,'vault.s3.connect');return {connected:true,bucket:'test',region:'us-east-1',prefix:'Portabase'};},persist:async()=>{}});
  assert.equal(status.connections.s3,true);assert.equal(JSON.stringify(status).includes('fixture-secret'),false);
});
test('invalid providers and running jobs cannot alter vault selection',async()=>{
  const base={pathname:'/vault-provider',form:new URLSearchParams({provider:'invalid'}),status:{connections:{}},command:async()=>assert.fail('unexpected command')};
  await assert.rejects(handleVaultAction(base),/invalid_vault_provider/);
  await assert.rejects(handleVaultAction({...base,status:{executing:true}}),/drill_already_running/);
  assert.equal(await handleVaultAction({...base,pathname:'/select'}),false);
});
