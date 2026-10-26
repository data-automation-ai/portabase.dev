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

test('GUI requires source, blank destination and connected Dropbox before run',()=>{
  const base={status:{state:'select_projects',connections:{source:true,target:true,dropbox:false},selection:{}},
    projects:{source:[{name:'Owner <source>',ref:'a'.repeat(20)}],target:[{name:'New destination',ref:'b'.repeat(20)}]},
    selection:{},links:{},nonce:'nonce'};
  const before=renderDryRunPage(base);
  assert.match(before,/Capsule destination · Dropbox/);
  assert.match(before,/Portabase Machine/);
  assert.match(before,/class="route"/);
  assert.match(before,/Authorize Dropbox/);
  assert.match(before,/Source Supabase/);
  assert.match(before,/Destination Supabase/);
  assert.match(before,/Authorizing as/);
  assert.match(before,/Load database objects/);
  assert.match(before,/Choose the Source project and its database objects in the picker below/);
  assert.match(before,/Authorize a different target account/);
  assert.match(before,/Confirm separate Supabase accounts/);
  assert.match(before,/cannot independently verify these emails/);
  assert.doesNotMatch(before,/Estimated capsule creation:/);
  assert.doesNotMatch(before,/action="\/execute"/);
  assert.match(before,/Owner &lt;source&gt;/);
  const ready=renderDryRunPage({...base,status:{...base.status,state:'preflight_passed',preflight:{
    source:{name:'Owner source',databaseBytes:12*1024**3,storageBytes:0},target:{name:'New destination',blank:true}}},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)}});
  assert.doesNotMatch(ready,/action="\/execute"/);
  const withDropbox=renderDryRunPage({...base,status:{...base.status,connections:{...base.status.connections,dropbox:true},
    state:'preflight_passed',preflight:{source:{databaseBytes:12*1024**3},target:{blank:true}},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)},
    inventory:{ref:'a'.repeat(20),tables:[{name:'public.orders',schema:'public',table:'orders',bytes:1024**2,estimatedRows:30,selectable:true}],
      buckets:[{id:'avatars',bytes:1024,objects:2,selectable:true}],authUsers:4,functions:1},
    scope:{tables:['public.orders'],buckets:['avatars'],auth:true,functions:true}},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)}});
  assert.match(withDropbox,/action="\/execute"/);
  assert.match(ready,/12\.00 GiB/);
  assert.match(withDropbox,/Type destination project ref/);
  assert.match(withDropbox,/Source object picker/);
  assert.match(withDropbox,/public/);
  assert.match(withDropbox,/avatars/);
  assert.match(withDropbox,/acknowledgeScope/);
  const occupied=renderDryRunPage({...base,status:{...base.status,state:'preflight_blocked',preflight:{target:{blank:false}}}});
  assert.doesNotMatch(occupied,/action="\/execute"/);
});

test('source picker makes schema inclusion and row-data scope explicit',()=>{
  const html=renderDryRunPage({status:{state:'preflight_passed',connections:{source:true,target:true,dropbox:true},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)},preflight:{target:{blank:true}},
    inventory:{ref:'a'.repeat(20),tables:[{name:'public.users',schema:'public',table:'users',bytes:1024**3,estimatedRows:120,selectable:true}],
      buckets:[],authUsers:2,functions:0},scope:{tables:['public.users'],buckets:[],auth:true,functions:false}},
    projects:{source:[],target:[]},selection:{source:'a'.repeat(20),target:'b'.repeat(20)},links:{},nonce:'nonce'});
  assert.match(html,/Database schemas and table definitions are always captured/);
  assert.match(html,/Select Buckets, Tables &amp; Objects/);
  assert.match(html,/Database schema · public/);
  assert.match(html,/PostgreSQL database · postgres/);
  assert.match(html,/Group total:/);
  assert.match(html,/name="tableIndex" value="0" checked/);
  assert.match(html,/Auth users/);
  assert.match(html,/Edge Functions/);
  assert.match(html,/Apply source selection/);
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

test('machine shows verified Google Cloud workload measurement',()=>{
  const digest=`sha256:${'a'.repeat(64)}`;
  const html=renderDryRunPage({status:{state:'select_projects',connections:{source:false,target:false,dropbox:false},
    attestation:{imageDigest:digest,keyFingerprint:'fingerprint-123',projectNumber:'495102144848',verifiedAt:'2026-10-26T14:00:00Z'}},
    projects:{source:[],target:[]},selection:{},links:{},nonce:'nonce'});
  assert.match(html,/Google Cloud/);
  assert.match(html,/Confidential Space · attestation verified/);
  assert.match(html,new RegExp(digest));
  assert.match(html,/fingerprint-123/);
});
