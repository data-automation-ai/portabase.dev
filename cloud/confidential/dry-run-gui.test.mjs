import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePastedCallback,renderDryRunPage} from './dry-run-gui.mjs';

test('pasted OAuth callback accepts only one code and state on the registered HTTPS route',()=>{
  assert.deepEqual(parsePastedCallback('https://portabase.dev/confidential/callback?code=abc&state=def'),{code:'abc',state:'def'});
  for(const url of [
    'http://portabase.dev/confidential/callback?code=abc&state=def',
    'https://portabase.dev/confidential/callback?code=abc&code=again&state=def',
    'https://evil.example/confidential/callback?code=abc&state=def',
    'https://portabase.dev/confidential/callback?state=def',
  ])assert.throws(()=>parsePastedCallback(url),/invalid_oauth_callback/);
});

test('GUI offers source and destination selection, optional vault, and gates run on blank target',()=>{
  const base={status:{state:'select_projects',connections:{source:true,target:true},selection:{}},
    projects:{source:[{name:'Owner <source>',ref:'a'.repeat(20)}],target:[{name:'New destination',ref:'b'.repeat(20)}]},
    selection:{},links:{},nonce:'nonce'};
  const before=renderDryRunPage(base);
  assert.match(before,/Capsule storage \(optional\)/);
  assert.match(before,/Portabase Machine/);
  assert.match(before,/class="route"/);
  assert.match(before,/Dropbox · unavailable for this trial/);
  assert.match(before,/Source Supabase/);
  assert.match(before,/Destination Supabase/);
  assert.doesNotMatch(before,/Estimated capsule creation:/);
  assert.doesNotMatch(before,/action="\/execute"/);
  assert.match(before,/Owner &lt;source&gt;/);
  const ready=renderDryRunPage({...base,status:{...base.status,state:'preflight_passed',preflight:{
    source:{name:'Owner source',databaseBytes:12*1024**3,storageBytes:0},target:{name:'New destination',blank:true}}},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)}});
  assert.match(ready,/action="\/execute"/);
  assert.match(ready,/12\.00 GiB/);
  assert.match(ready,/Type destination project ref/);
  const occupied=renderDryRunPage({...base,status:{...base.status,state:'preflight_blocked',preflight:{target:{blank:false}}}});
  assert.doesNotMatch(occupied,/action="\/execute"/);
});

test('machine shows estimated capture progress and keeps restore separate',()=>{
  const base={projects:{source:[],target:[]},selection:{},links:{},nonce:'nonce',status:{
    state:'capturing',executing:true,connections:{source:false,target:false}}};
  const pending=renderDryRunPage(base);
  assert.match(pending,/estimate pending/);
  assert.doesNotMatch(pending,/Estimated capsule creation:/);
  const phase=renderDryRunPage({...base,status:{...base.status,backup:{state:'running',phase:'encrypt'}}});
  assert.match(phase,/Estimated capsule creation: <strong>91%/);
  assert.match(phase,/Coarse phase estimate/);
  const reported=renderDryRunPage({...base,status:{...base.status,backup:{state:'running',phase:'transfer',progressKind:'estimate',estimatedPercent:98},
    restore:{state:'running',phase:'replay'}}});
  assert.match(reported,/Estimated capsule creation: <strong>98%/);
  assert.match(reported,/Restore: <strong>running<\/strong> · replay/);
  const incomplete=renderDryRunPage({...base,status:{...base.status,backup:{state:'running',phase:'done',progressKind:'estimate',estimatedPercent:100}}});
  assert.match(incomplete,/Estimated capsule creation: <strong>99%/);
  const complete=renderDryRunPage({...base,status:{...base.status,backup:{state:'complete',phase:'complete'}}});
  assert.match(complete,/Estimated capsule creation: <strong>100%/);
});
