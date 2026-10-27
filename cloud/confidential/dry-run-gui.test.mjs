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

test('GUI requires source and blank destination and offers explicit capsule handling',()=>{
  const base={status:{state:'select_projects',connections:{source:true,target:true,dropbox:false},selection:{}},
    projects:{source:[{name:'Owner <source>',ref:'a'.repeat(20)}],target:[{name:'New destination',ref:'b'.repeat(20)}]},
    selection:{},links:{},nonce:'nonce'};
  const before=renderDryRunPage(base);
  assert.match(before,/Capsule destination/);
  assert.match(before,/Portabase Machine/);
  assert.match(before,/class="route"/);
  assert.match(before,/Authorize Dropbox/);
  assert.doesNotMatch(before,/http-equiv="refresh"/i);
  assert.match(before,/data-refresh-ms="30000"/);
  assert.match(before,/Source Supabase/);
  assert.match(before,/Destination Supabase/);
  assert.match(before,/Authorizing as/);
  assert.match(before,/Load database objects/);
  assert.match(before,/Choose database objects from the center machine/);
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
  assert.doesNotMatch(withDropbox,/Type destination project ref/);
  assert.doesNotMatch(withDropbox,/confirmTarget/);
  assert.match(withDropbox,/allowOverwrite/);
  assert.match(withDropbox,/Allow overwrite of existing destination objects/);
  assert.match(withDropbox,/Source object picker/);
  assert.match(withDropbox,/public/);
  assert.match(withDropbox,/avatars/);
  assert.match(withDropbox,/acknowledgeScope/);
  assert.match(withDropbox,/name="vault" required/);
  assert.match(withDropbox,/value="temporary_runner"/);
  assert.match(withDropbox,/not a durable backup/);
  const occupied=renderDryRunPage({...base,status:{...base.status,state:'preflight_blocked',preflight:{target:{blank:false}}}});
  assert.doesNotMatch(occupied,/action="\/execute"/);
  const occupiedPassed=renderDryRunPage({...base,status:{...base.status,connections:{...base.status.connections,dropbox:true},
    state:'preflight_passed',preflight:{source:{databaseBytes:12*1024**3},target:{name:'Occupied target',blank:false}},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)},
    inventory:{ref:'a'.repeat(20),tables:[{name:'public.orders',schema:'public',table:'orders',bytes:1024**2,estimatedRows:30,selectable:true}],
      buckets:[{id:'avatars',bytes:1024,objects:2,selectable:true}],authUsers:4,functions:1},
    scope:{tables:['public.orders'],buckets:['avatars'],auth:true,functions:true}},
    selection:{source:'a'.repeat(20),target:'b'.repeat(20)}});
  assert.match(occupiedPassed,/action="\/execute"/);
  assert.match(occupiedPassed,/existing objects detected \(overwrite allowed below\)/);
  assert.match(occupiedPassed,/name="allowOverwrite" value="yes" checked/);
  assert.doesNotMatch(occupiedPassed,/Type destination project ref/);
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
  assert.match(pending,/data-refresh-ms="5000"/);
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
  assert.match(html,/Intel TDX/);
  assert.match(html,/Anti-Landlord memory encryption · boot-measured · SSH\/debug disabled/);
  assert.match(html,/VM Image SHA-256:/);
  assert.match(html,/Secure Enclave Key ID:/);
  assert.match(html,/495102144848/);
  assert.match(html,/2026-10-26T14:00:00Z/);
  assert.match(html,/How to decrypt &amp; open your capsule independently of portabase\.dev/);
  assert.match(html,/scrypt \+ AES-256-GCM/);
  assert.match(html,/portabase-aes256gcm-v1/);
  assert.match(html,/PORTABASE_ENCRYPTION_PASSPHRASE/);
  assert.match(html,/npx portabase verify --capsule/);
  assert.match(html,/scryptSync/);
  assert.match(html,/capsule\.pbase/);
  assert.match(html,/capsule\.tar\.gz/);
});

test('GUI supports all 4 operation modes including capsule_only and restore_only',()=>{
  const base={
    status:{
      state:'select_projects',
      connections:{source:true,target:true,dropbox:true},
      selection:{},
      mode:'temporary_runner',
      capsules:['ekklokrukxmqlahtonnc-2026-10-27T08-18-22.962Z'],
    },
    projects:{
      source:[{name:'Owner source',ref:'a'.repeat(20)}],
      target:[{name:'New destination',ref:'b'.repeat(20)}],
    },
    selection:{},
    links:{},
    nonce:'nonce',
  };
  const html=renderDryRunPage(base);
  assert.match(html,/action="\/mode"/);
  assert.match(html,/value="dropbox"/);
  assert.match(html,/value="temporary_runner"/);
  assert.match(html,/value="capsule_only"/);
  assert.match(html,/value="restore_only"/);

  const capsuleOnlyHtml=renderDryRunPage({
    ...base,
    status:{
      ...base.status,
      state:'preflight_passed',
      mode:'capsule_only',
      preflight:{source:{databaseBytes:1024**3}},
      inventory:{ref:'a'.repeat(20),tables:[{name:'public.users',schema:'public',table:'users',bytes:1024,estimatedRows:1,selectable:true}],buckets:[],authUsers:0,functions:0},
      scope:{tables:['public.users'],buckets:[],auth:false,functions:false},
    },
    selection:{source:'a'.repeat(20)},
  });
  assert.match(capsuleOnlyHtml,/action="\/execute"/);

  const restoreOnlyHtml=renderDryRunPage({
    ...base,
    status:{
      ...base.status,
      state:'preflight_passed',
      mode:'restore_only',
      preflight:{target:{name:'Target',blank:true}},
    },
    selection:{target:'b'.repeat(20)},
  });
  assert.match(restoreOnlyHtml,/action="\/execute"/);
  assert.match(restoreOnlyHtml,/name="dropboxCapsuleId"/);
  assert.match(restoreOnlyHtml,/ekklokrukxmqlahtonnc-2026-10-27T08-18-22\.962Z/);
});

test('dark-mode Intel TDX schematic GUI renders perimeter warning, enclave frame, and S3 vault controls', () => {
  const base = {
    status: {
      state: 'preflight_passed',
      connections: { source: true, target: true, dropbox: false, s3: true },
      activeVault: 's3',
      s3Summary: { bucket: 'my-portabase-vault', region: 'us-east-1', prefix: 'Portabase' },
      selection: { source: 'a'.repeat(20), target: 'b'.repeat(20) },
      preflight: { source: { name: 'Source DB', databaseBytes: 1024**3 }, target: { name: 'Dest DB', blank: true } },
      inventory: { ref: 'a'.repeat(20), tables: [{ name: 'public.users', schema: 'public', table: 'users', bytes: 1024, estimatedRows: 1, selectable: true }], buckets: [], authUsers: 0, functions: 0 },
      scope: { tables: ['public.users'], buckets: [], auth: false, functions: false },
    },
    projects: {
      source: [{ name: 'Source DB', ref: 'a'.repeat(20) }],
      target: [{ name: 'Dest DB', ref: 'b'.repeat(20) }],
    },
    selection: { source: 'a'.repeat(20), target: 'b'.repeat(20) },
    links: {},
    nonce: 'nonce123',
  };

  const html = renderDryRunPage(base);
  assert.doesNotMatch(html, /UNTRUSTED CLOUD HOST \/ HYPERVISOR/);
  assert.match(html, /background:#ffffff!important/);
  assert.match(html, /SECURE RUNNER \(INTEL TDX HARDWARE-ENCRYPTED ENCLAVE/);
  assert.match(html, /Source OAuth Connection/);
  assert.match(html, /Dest OAuth Connection/);
  assert.match(html, /ENCLAVE CORE — AES-256-GCM \+ TDX RAM/);
  assert.match(html, /Vault OAuth \/ S3 Connector/);
  assert.match(html, /action="\/vault-provider"/);
  assert.match(html, /action="\/s3"/);
  assert.match(html, /my-portabase-vault/);
  assert.doesNotMatch(html, /provider-badge aws-badge/);
  assert.doesNotMatch(html, /provider-badge s3-badge/);
  assert.match(html, /provider-badge supabase-badge/);
  assert.match(html, /data-meter="source-read"/);
  assert.match(html, /data-meter="destination-write"/);
  assert.match(html, /Encrypted \.pbase Bus/);
  assert.match(html, /Capsule Jar \+ Hash Verified/);
  assert.match(html, /Existing Capsule Picker/);
  assert.match(html, /Decrypt Guide/);
  assert.match(html, /btn-execute/);
  assert.match(html, /enclave-chassis-svg/);
  assert.match(html, /INTEL TDX ENCLAVE · ANTI-LANDLORD SILICON/);
  assert.match(html, /src-to-core/);
  assert.match(html, /core-to-dst/);
  assert.match(html, /core-to-vault/);
  assert.match(html, /action="\/select-batch"/);
  assert.match(html, /name="sourceRefs"/);
  assert.match(html, /legacy-diagnostics/);
});

test('anti-sticky-cookie controls render incognito copy button, signout link, and PAT bypass form', () => {
  const html = renderDryRunPage({
    status: {
      state: 'starting',
      connections: { source: false, target: false, dropbox: false },
      selection: {},
    },
    projects: { source: [], target: [] },
    selection: {},
    links: {
      source: 'https://api.supabase.com/v1/oauth/authorize?client_id=src',
      target: 'https://api.supabase.com/v1/oauth/authorize?client_id=tgt&prompt=login',
    },
    nonce: 'test-nonce-123',
  });
  assert.match(html, /class="btn-copy-incognito"/);
  assert.match(html, /data-copy-url="https:\/\/api\.supabase\.com\/v1\/oauth\/authorize\?client_id=tgt&amp;prompt=login"/);
  assert.match(html, /📋 Copy Link for Incognito Window/);
  assert.match(html, /1\. Sign out of Supabase\.com first ↗/);
  assert.match(html, /<details class="pat-connect"/);
  assert.match(html, /🔑 Use Access Token \(sbp_… · Bypass Browser Cookie\)/);
  assert.match(html, /action="\/supabase-token"/);
  assert.match(html, /name="token"/);
  assert.match(html, /Connect source token/);
  assert.match(html, /Connect target token/);
});
