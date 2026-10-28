import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encryptedBinaryCatalog} from './binary-catalog.mjs';
import {sealManifest,openManifest} from './manifest-envelope.mjs';
import {captureStorage} from '../../utility/portabase.mjs';
const owner='a'.repeat(64),sourceRef='s'.repeat(20),recoveryKey=Buffer.alloc(32,7).toString('base64url');
function vault(){const objects=new Map(),writes=[],reads=[];return {objects,writes,reads,store:{
  async put(key,data){assert.ok(!objects.has(key));objects.set(key,Buffer.from(data));writes.push(key);},
  async get(key){reads.push(key);if(!objects.has(key))throw Error('missing');return Buffer.from(objects.get(key));},
  async has(key){return objects.has(key);},async list(ns){return [...objects.keys()].filter(k=>k.startsWith(ns+'/manifests/'));}}};}
const catalog=(v,options={})=>encryptedBinaryCatalog({store:v.store,owner,sourceRef,recoveryKey,...options});
test('baseline then changed/new/deleted objects restore after runner restart with no unchanged transfer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pb-binary-test-')),v=vault();
  try{
    const files={keep:join(root,'keep'),change:join(root,'change'),remove:join(root,'remove'),add:join(root,'add')};
    for(const [name,file] of Object.entries(files))await writeFile(file,name==='change'?'AAAA':name);
    const first=catalog(v,{now:()=>1000});await first.load();first.begin();
    for(const name of ['keep','change','remove'])await first.capture({bucket:'photos',name:name+'.bin',file:files[name],etag:'"'+name+'-v1"'});
    const firstSnapshot=first.snapshot();const receipt=await first.commit('capsule-first');first.close();
    assert.equal(receipt.initialBinarySnapshot,true);assert.equal(v.writes.length,4);
    const second=catalog(v,{now:()=>2000});await second.load();second.begin();
    const beforeReads=v.reads.length,beforeWrites=v.writes.length;
    await second.reuse(second.previous('photos','keep.bin'));
    assert.equal(v.reads.length,beforeReads);assert.equal(v.writes.length,beforeWrites);
    await writeFile(files.change,'BBBB');
    await second.capture({bucket:'photos',name:'change.bin',file:files.change,etag:'"change-v2"'});
    await second.capture({bucket:'photos',name:'add.bin',file:files.add,etag:'"add-v1"'});
    const secondSnapshot=second.snapshot();await second.commit('capsule-second');second.close();
    assert.equal(v.writes.length-beforeWrites,3);assert.deepEqual(secondSnapshot.tombstones,[{bucket:'photos',name:'remove.bin'}]);
    assert.equal(secondSnapshot.baselineId,firstSnapshot.id);
    const restarted=catalog(v);const loaded=await restarted.load();assert.equal(loaded.count,2);
    await restarted.restore(loaded.latest,join(root,'restore'));
    assert.equal(await readFile(join(root,'restore/photos/keep.bin'),'utf8'),'keep');
    assert.equal(await readFile(join(root,'restore/photos/change.bin'),'utf8'),'BBBB');
    await assert.rejects(readFile(join(root,'restore/photos/remove.bin')),{code:'ENOENT'});
    await restarted.restore(firstSnapshot,join(root,'first-restore'));
    assert.equal(await readFile(join(root,'first-restore/photos/change.bin'),'utf8'),'AAAA');
    for(const [name,bytes] of v.objects){assert.ok(!name.includes('photos'));assert.ok(!bytes.includes(Buffer.from('photos')));assert.ok(!bytes.includes(Buffer.from('change.bin')));}
    restarted.close();
  }finally{await rm(root,{recursive:true,force:true});}
});
test('tampering, missing baseline, wrong key and malicious restore paths fail closed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pb-binary-negative-')),v=vault();
  try{
    const file=join(root,'object');await writeFile(file,'secret');const c=catalog(v);await c.load();c.begin();await c.capture({bucket:'a',name:'file',file,etag:'"version"'});const snapshot=c.snapshot();await c.commit('backup');c.close();
    await assert.rejects(catalog(v,{recoveryKey:Buffer.alloc(32,9).toString('base64url')}).load(),/authentication/);
    const c2=catalog(v);await c2.load();const evil=structuredClone(snapshot);evil.objects[0].name='../escape';await assert.rejects(c2.restore(evil,join(root,'out')),/unsafe_binary_path/);
    const objectKey=v.writes.find(k=>k.includes('/objects/'));v.objects.get(objectKey)[20]^=1;
    await assert.rejects(c2.restore(snapshot,join(root,'out')),/authentication/);
    v.objects.delete(objectKey);c2.begin();await assert.rejects(c2.reuse(c2.previous('a','file')),/binary_reference_missing/);c2.close();
    const manifestKey=v.writes.find(k=>k.includes('/manifests/'));v.objects.get(manifestKey)[20]^=1;
    await assert.rejects(catalog(v).load(),/authentication/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('outer manifest is encrypted, authenticated and does not expose project or object names',()=>{
  const privateManifest={projectRef:sourceRef,contents:{storage:{name:'private-object.png'}},encryption:{algorithm:'example'}};
  const encrypted=sealManifest(privateManifest,recoveryKey),encoded=JSON.stringify(encrypted);
  assert.ok(!encoded.includes(sourceRef));assert.ok(!encoded.includes('private-object'));assert.deepEqual(openManifest(encrypted,recoveryKey),privateManifest);
  encrypted.payload=(encrypted.payload[0]==='A'?'B':'A')+encrypted.payload.slice(1);
  assert.throws(()=>openManifest(encrypted,recoveryKey),/manifest_authentication/);
});
test('actual Storage capture uses strong HEAD validator, refuses weak prior metadata, and keeps DB path separate',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pb-storage-incremental-')),v=vault(),fetchBefore=globalThis.fetch;
  const env={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
  let etag='"version1"',body='AAAA',gets=0,heads=0;
  process.env.SUPABASE_URL='https://'+sourceRef+'.supabase.co';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic';
  globalThis.fetch=async(url,options={})=>{
    if(url.endsWith('/storage/v1/bucket'))return Response.json([{id:'photos',name:'photos',public:false}]);
    if(url.includes('/object/list/'))return Response.json([{id:'object1',name:'same.bin',updated_at:'2026-01-01',metadata:{size:4,eTag:'untrusted-listing'}}]);
    if(options.method==='HEAD'){heads++;return new Response(null,{status:200,headers:{etag}});}
    gets++;return new Response(body,{headers:{etag}});
  };
  try{
    const first=catalog(v,{now:()=>1000});await first.load();first.begin();
    await captureStorage(join(root,'first'),null,{projectRef:sourceRef,backupDirectory:join(root,'cache1'),binaryCatalog:first});await first.commit('one');first.close();assert.equal(gets,1);
    const second=catalog(v,{now:()=>2000});await second.load();second.begin();
    await captureStorage(join(root,'second'),null,{projectRef:sourceRef,backupDirectory:join(root,'cache2'),binaryCatalog:second});await second.commit('two');second.close();assert.equal(gets,1);assert.equal(heads,1);
    etag='"version2"';body='BBBB';const third=catalog(v,{now:()=>3000});await third.load();third.begin();
    await captureStorage(join(root,'third'),null,{projectRef:sourceRef,backupDirectory:join(root,'cache3'),binaryCatalog:third});await third.commit('three');third.close();assert.equal(gets,2);
    etag='W/"weak"';const fourth=catalog(v);await fourth.load();fourth.begin();
    await assert.rejects(captureStorage(join(root,'fourth'),null,{projectRef:sourceRef,backupDirectory:join(root,'cache4'),binaryCatalog:fourth}),/binary_strong_validator_required/);fourth.close();assert.equal(gets,2);
  }finally{globalThis.fetch=fetchBefore;for(const [key,value]of Object.entries(env)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true});}
});

test('quota denial and failed upload leave only accepted attempts and no committed manifest',async()=>{
  const {reserveTransferUsage}=await import('../../utility/portabase.mjs');
  const root=await mkdtemp(join(tmpdir(),'pb-binary-quota-')),v=vault(),totals={databaseBytes:0,binaryBytes:0,otherBytes:0};
  const reservations=[];
  const meter={async reserve(next){if(next.binaryBytes>40)throw Error('transfer_limit');reservations.push({...next});}};
  try{
    const file=join(root,'object');await writeFile(file,'AAAA');
    const c=catalog(v,{onTransfer:e=>reserveTransferUsage(meter,totals,{binaryBytes:e.binaryBytes,otherBytes:e.otherBytes||0})});
    await c.load();c.begin();await c.capture({bucket:'a',name:'one',file,etag:'"one"'});
    await assert.rejects(c.capture({bucket:'a',name:'two',file,etag:'"two"'}),/transfer_limit/);
    assert.equal(totals.binaryBytes,36);assert.equal(c.transferred().binaryBytes,36);assert.equal(v.writes.length,1);
    assert.equal((await catalog(v).load()).count,0);c.close();
    const failed=vault(),accepted={databaseBytes:0,binaryBytes:0,otherBytes:0};failed.store.put=async()=>{throw Error('upload_failed');};
    const c2=catalog(failed,{onTransfer:e=>reserveTransferUsage({reserve:async()=>{}},accepted,{binaryBytes:e.binaryBytes})});await c2.load();c2.begin();
    await assert.rejects(c2.capture({bucket:'a',name:'one',file,etag:'"one"'}),/upload_failed/);
    assert.equal(accepted.binaryBytes,36);assert.equal(c2.transferred().binaryBytes,36);assert.equal((await catalog(failed).load()).count,0);c2.close();
  }finally{await rm(root,{recursive:true,force:true});}
});

test('partial scope never tombstones excluded buckets and a missing retained baseline fails closed',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pb-binary-scope-')),v=vault();
  try{
    const file=join(root,'object');await writeFile(file,'A');
    const first=catalog(v,{now:()=>1000});await first.load();first.begin();
    await first.capture({bucket:'selected',name:'one',file,etag:'"one"'});
    await first.capture({bucket:'excluded',name:'two',file,etag:'"two"'});await first.commit('first');first.close();
    const second=catalog(v,{now:()=>2000});await second.load();second.begin();second.setScope(['selected']);
    await second.reuse(second.previous('selected','one'));assert.deepEqual(second.snapshot().tombstones,[]);await second.commit('second');second.close();
    const third=catalog(v);await third.load();assert.equal(third.previous('excluded','two').name,'two');third.close();
    v.objects.delete(v.writes.find(key=>key.includes('/manifests/')));
    await assert.rejects(catalog(v).load(),/binary_baseline_missing/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('parallel capture drains in-flight work before failure accounting and stops new jobs',async()=>{
  const {mapPool}=await import('../../utility/portabase-core.mjs');
  let release,started=[],finished=false;
  const drain=new Promise(resolve=>{release=resolve;});
  const pending=mapPool([0,1,2,3],2,async i=>{started.push(i);if(i===0){await Promise.resolve();throw Error('quota_denied');}await drain;finished=true;});
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(started,[0,1]);assert.equal(finished,false);
  release();await assert.rejects(pending,/quota_denied/);assert.equal(finished,true);assert.deepEqual(started,[0,1]);
});

test('large capsule upload and readback stream bounded chunks instead of buffering whole file',async()=>{
  const root=await mkdtemp(join(tmpdir(),'pb-large-s3-'));
  try{
    const {uploadCapsuleToS3}=await import('./s3-vault.mjs');
    const file=join(root,'capsule.pbase'),size=9*1024*1024;await writeFile(file,Buffer.alloc(size,19));
    let sent=0,streamed=false;
    const result=await uploadCapsuleToS3(root,{bucket:'synthetic-vault',accessKeyId:'synthetic',secretAccessKey:'synthetic',fetchImpl:async(_url,request)=>{
      if(request.method==='PUT'){
        assert.equal(Buffer.isBuffer(request.body),false);assert.equal(request.duplex,'half');
        for await(const chunk of request.body){assert.ok(chunk.length<=1024*1024);sent+=chunk.length;}streamed=true;return new Response('');
      }
      return {ok:true,body:(async function*(){for(let i=0;i<size;i+=65536)yield Buffer.alloc(Math.min(65536,size-i),19);})()};
    }});
    assert.equal(sent,size);assert.equal(streamed,true);assert.equal(result.verified,true);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('private capsule reader opens a managed encrypted manifest while retaining standalone support',async()=>{
  const {privateCapsuleFixture}=await import('../../tests/fixtures/private-capsule.mjs');
  const {readPrivateCapsule}=await import('../../utility/capsule-review-reader.mjs');
  const {encryptFile}=await import('../../utility/capsule-crypto.mjs');
  const fixture=await privateCapsuleFixture();
  try{
    await rm(join(fixture.capsule,'capsule.pbase'));
    fixture.metadata.encryption=await encryptFile(fixture.archive,join(fixture.capsule,'capsule.pbase'),recoveryKey,fixture.metadata.id);
    await writeFile(join(fixture.capsule,'capsule.json'),JSON.stringify(sealManifest(fixture.metadata,recoveryKey)));
    const review=await readPrivateCapsule({...fixture.options,passphrase:recoveryKey});
    assert.equal(review.capsuleId,fixture.metadata.id);assert.deepEqual(review.tables.map(row=>row.table),['orders','empty']);
    await assert.rejects(readPrivateCapsule({...fixture.options,passphrase:Buffer.alloc(32,8).toString('base64url')}),/invalid_capsule_metadata/);
  }finally{await rm(fixture.directory,{recursive:true,force:true});}
});
