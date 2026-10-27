import test from 'node:test';
import assert from 'node:assert/strict';
import {confidentialClient} from './client.mjs';
import {commandChannel} from './command-channel.mjs';
import {importJWK} from 'jose';
const policy={imageDigest:`sha256:${'a'.repeat(64)}`,projectNumber:'495102144848',hardware:'GCP_INTEL_TDX',workload:'application'};
test('failed attestation prevents sending a recovery key or any command',async()=>{
  const requests=[];const client=confidentialClient({url:'https://controller.example',policy,getAuthorization:async()=>'Bearer fixture',
    fetchImpl:async(url,options)=>{requests.push({url,body:options.body});return Response.json({});},verify:async()=>{throw new Error('attestation_rejected:image_digest');}});
  await assert.rejects(client.command('session.open',{recoveryKey:'sensitive-customer-key'}),/attestation_rejected/);
  assert.equal(requests.length,1);assert.ok(requests[0].url.endsWith('/attest'));assert.ok(!requests[0].body.includes('sensitive-customer-key'));
});
test('command and result round-trip privately through the protocol fixture',async()=>{
  const owner='b'.repeat(64),requests=[];
  const channel=commandChannel({attest:async()=>'software-fixture-only',dispatch:async({input})=>({received:input.privateValue})});
  const client=confidentialClient({url:'https://controller.example',policy,getAuthorization:async()=>'Bearer fixture',
    verify:async offer=>({encryptionKey:await importJWK(offer.publicKey,'RSA-OAEP-256'),evidence:{imageDigest:policy.imageDigest}}),
    fetchImpl:async(url,options)=>{requests.push(options.body);const body=JSON.parse(options.body);
      return Response.json(url.endsWith('/attest')?await channel.offer(owner,body.challenge):await channel.execute(owner,body));}});
  assert.deepEqual(await client.command('fixture',{privateValue:'private-table-name'}),{received:'private-table-name'});
  assert.ok(requests.every(x=>!x.includes('private-table-name')));assert.equal(client.evidence().imageDigest,policy.imageDigest);
});
