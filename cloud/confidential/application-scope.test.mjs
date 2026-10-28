import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { confidentialApplication } from './application.mjs';

test('source inventory returns names and estimates, and selected scope reaches capture config', async () => {
  const sourceRef='s'.repeat(20),targetRef='t'.repeat(20),owner='a'.repeat(64);
  const recoveryKey=randomBytes(32).toString('base64url');
  const sourceApi={
    async query(_ref,sql){
      if(sql.includes('FROM storage.buckets'))return [
        {bucket_id:'avatars',object_count:'2',size_bytes:'2048'},
        {bucket_id:'exports',object_count:'1',size_bytes:'4096'},
      ];
      return [
        {schema_name:'public',table_name:'users',estimated_rows:'7',size_bytes:'4096'},
        {schema_name:'public',table_name:'events',estimated_rows:'12',size_bytes:'8192'},
      ];
    },
    async inspect(ref){return {ref,name:ref===sourceRef?'Source':'Target',functions:1,authUsers:5,
      databaseBytes:16384,storageBytes:2048,measuredBytes:18432,blank:ref===targetRef};},
  };
  const connections={access(_profile,slot){return {token:`synthetic-${slot}-token`,api:sourceApi};}};
  let started;
  const jobs={async start(options){started=options;await options.authorize();return {id:'job',state:'running'};}};
  const app=confidentialApplication({oauthConfig:{},connections,jobs,
    vault:{async provider(){return {type:'dropbox'};}},
    s3:{async connect(profile){profile.s3={bucket:'test-vault'};profile.activeVault='s3';return {connected:true};},
      async provider(){return {type:'s3',bucket:'test-vault'};}},
    r2:{async connect(profile){profile.r2={bucket:'test-r2'};profile.activeVault='r2';return {connected:true};},
      async provider(){return {type:'r2',bucket:'test-r2'};}},
    admit:async()=>({maxBytes:100*1024**2})});
  const call=(operation,input={})=>app({owner,operation,input,authorization:'Bearer synthetic'});
  await call('session.open',{recoveryKey});
  await call('key.acknowledge');
  await call('project.select',{slot:'source',ref:sourceRef});
  await call('project.select',{slot:'target',ref:targetRef});
  const {inventory}=await call('source.inventory');
  assert.deepEqual(inventory.tables.map(row=>row.name),['public.users','public.events']);
  assert.equal(inventory.tables[1].estimatedRows,12);
  assert.deepEqual(inventory.buckets.map(row=>[row.id,row.objects,row.bytes]),[['avatars',2,2048],['exports',1,4096]]);
  assert.equal(inventory.authUsers,5);
  const scope={tables:['public.users'],buckets:['avatars'],auth:true,functions:false};
  await call('backup.start',{requestId:'request',vault:'dropbox',scope});
  assert.deepEqual(started.scope.includeTableData,['public.users']);
  assert.deepEqual(started.scope.includeBuckets,['avatars']);
  assert.equal(started.scope.storage,true);
  assert.equal(started.scope.auth,true);
  assert.equal(started.scope.functions,false);
  assert.equal(started.scopeSummary.tables,1);
  assert.equal(started.scopeSummary.estimatedTableBytes,4096);
  await assert.rejects(call('backup.start',{requestId:'request',vault:'google-drive',scope}),/unsupported_vault/);
  await call('backup.start',{requestId:'request',vault:'temporary_runner',scope});
  assert.equal(started.provider,undefined,'temporary mode does not silently become a remote vault');
  await call('vault.s3.connect',{bucket:'test-vault'});
  await call('backup.start',{requestId:'request',vault:'dropbox',vaultProvider:'s3',scope});
  assert.equal(started.provider.type,'s3','selected S3 provider reaches the capture job');
  await call('vault.r2.connect',{bucket:'test-r2'});
  await call('backup.start',{requestId:'request',vault:'dropbox',vaultProvider:'r2',scope});
  assert.equal(started.provider.type,'r2','selected R2 provider reaches the capture job');
});

test('backup start rejects stale objects instead of silently changing the chosen source scope', async () => {
  const sourceRef='s'.repeat(20),targetRef='t'.repeat(20),owner='b'.repeat(64);
  const recoveryKey=randomBytes(32).toString('base64url');
  const api={query(_ref,sql){return Promise.resolve(sql.includes('FROM storage.buckets')?[]:[]);},
    async inspect(ref){return {ref,name:'Project',functions:0,authUsers:0,databaseBytes:0,storageBytes:0,measuredBytes:0,blank:true};}};
  const app=confidentialApplication({oauthConfig:{},connections:{access(){return {token:'synthetic-access-token',api};}},
    jobs:{async start(){assert.fail('stale selection must not start a job');}},admit:async()=>({maxBytes:1024})});
  const call=(operation,input={})=>app({owner,operation,input,authorization:'Bearer synthetic'});
  await call('session.open',{recoveryKey});await call('key.acknowledge');
  await call('project.select',{slot:'source',ref:sourceRef});await call('project.select',{slot:'target',ref:targetRef});
  await assert.rejects(call('backup.start',{requestId:'request',scope:{tables:['public.missing'],buckets:[],auth:true,functions:true}}),/source_scope_stale/);
});

test('application forwards vault begin with redirectUri, finish with code and state, and disconnects', async () => {
  const owner = 'c'.repeat(64), recoveryKey = randomBytes(32).toString('base64url');
  let beginCalledWith = null, finishCalledWith = null;
  const vault = {
    begin(profile, redirectUri) {
      beginCalledWith = redirectUri;
      profile.dropboxPending = { state: 'test-state' };
      return { url: 'https://dropbox.com/oauth', state: 'test-state', redirectUri };
    },
    async finish(profile, input) {
      finishCalledWith = input;
      profile.dropbox = { refreshToken: 'token-123' };
      return { connected: true };
    },
  };
  const app = confidentialApplication({ oauthConfig: {}, connections: {}, jobs: {}, vault, admit: async () => ({ maxBytes: 1024 }) });
  const call = (operation, input = {}) => app({ owner, operation, input, authorization: 'Bearer synthetic' });
  await call('session.open', { recoveryKey });
  const begun = await call('vault.begin', { redirectUri: 'http://localhost:58441/oauth/dropbox/callback' });
  assert.equal(beginCalledWith, 'http://localhost:58441/oauth/dropbox/callback');
  assert.equal(begun.state, 'test-state');
  const finished = await call('vault.finish', { code: 'code-123', state: 'test-state' });
  assert.deepEqual(finishCalledWith, { code: 'code-123', state: 'test-state' });
  assert.equal(finished.connected, true);
  const disconnected = await call('vault.disconnect');
  assert.equal(disconnected.connected, false);
});
