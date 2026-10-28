import test from 'node:test';
import assert from 'node:assert/strict';
import {binaryVaultStore} from './binary-vault-store.mjs';
const namespace='a'.repeat(64),id='11111111-1111-4111-8111-111111111111',id2='22222222-2222-4222-8222-222222222222';
const provider={type:'s3',bucket:'synthetic-vault',region:'us-east-1',accessKeyId:'synthetic',secretAccessKey:'synthetic'};
test('S3 catalog listing paginates scoped opaque keys and preserves service failures',async()=>{
  let calls=0;
  const store=binaryVaultStore(provider,{fetchImpl:async url=>{calls++;const cursor=new URL(url).searchParams.get('continuation-token');return new Response(`<ListBucketResult><Contents><Key>Portabase/.binary-v1/${namespace}/manifests/${cursor?id2:id}</Key></Contents><IsTruncated>${!cursor}</IsTruncated>${cursor?'':'<NextContinuationToken>next&amp;page</NextContinuationToken>'}</ListBucketResult>`);}});
  assert.deepEqual(await store.list(namespace),[`${namespace}/manifests/${id}`,`${namespace}/manifests/${id2}`]);assert.equal(calls,2);
  await assert.rejects(binaryVaultStore(provider,{fetchImpl:async()=>new Response('',{status:403})}).list(namespace),/unavailable/);
  await assert.rejects(binaryVaultStore(provider,{fetchImpl:async()=>new Response('<Key>other-customer/private</Key>')}).list(namespace),/scope_mismatch/);
});
test('ciphertext writes require exact authenticated readback, and missing HEAD is explicit',async()=>{
  const sent=Buffer.from('ciphertext'),key=`${namespace}/objects/${id}`;let calls=0;
  const store=binaryVaultStore(provider,{fetchImpl:async(_url,request)=>{calls++;if(request.method==='PUT'){assert.equal(request.headers['If-None-Match'],'*');return new Response('');}return new Response(sent);}});
  await store.put(key,sent);assert.equal(calls,2);
  await assert.rejects(binaryVaultStore(provider,{fetchImpl:async(_url,r)=>new Response(r.method==='PUT'?'':'wrong')}).put(key,sent),/readback_failed/);
  assert.equal(await binaryVaultStore(provider,{fetchImpl:async()=>new Response(null,{status:404})}).has(key),false);
});
test('Dropbox only treats explicit absent folder as empty; authentication never starts new catalog',async()=>{
  const db={type:'dropbox',accessToken:'synthetic',folderPath:'/Portabase'};
  const missing={error:{'.tag':'path',path:{'.tag':'not_found'}}};
  assert.deepEqual(await binaryVaultStore(db,{fetchImpl:async()=>Response.json(missing,{status:409})}).list(namespace),[]);
  await assert.rejects(binaryVaultStore(db,{fetchImpl:async()=>Response.json({error:'expired_access_token'},{status:401})}).list(namespace),/unavailable/);
});
