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
    vault:{async provider(){return {type:'dropbox'};}},admit:async()=>({maxBytes:100*1024**2})});
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
