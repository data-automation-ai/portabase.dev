import test from 'node:test';
import assert from 'node:assert/strict';
import {confidentialClient} from './client.mjs';
import {commandChannel} from './command-channel.mjs';
import {importJWK,CompactEncrypt} from 'jose';
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
test('hosted grant bridge runs only after verified attestation and replies remain bound',async()=>{
  let bridgeCalled=false;
  const denied=confidentialClient({url:'https://controller.example',policy,getAuthorization:async()=>'Bearer fixture',fetchImpl:async()=>Response.json({}),verify:async()=>{throw Error('rejected');}});
  await assert.rejects(denied.command('oauth.import',{}, {envelopeFactory:async()=>{bridgeCalled=true;return 'invalid';}}),/rejected/);
  assert.equal(bridgeCalled,false);
  const owner='b'.repeat(64),channel=commandChannel({attest:async()=>'fixture',dispatch:async({operation,input})=>({operation,received:input.slot})});
  const client=confidentialClient({url:'https://controller.example',policy,getAuthorization:async()=>'Bearer fixture',
    verify:async offer=>({encryptionKey:await importJWK(offer.publicKey,'RSA-OAEP-256'),evidence:{imageDigest:policy.imageDigest}}),
    fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);return Response.json(url.endsWith('/attest')?await channel.offer(owner,body.challenge):await channel.execute(owner,body));}});
  const result=await client.command('oauth.import',{}, {envelopeFactory:async({offer,challenge,responseKey})=>new CompactEncrypt(new TextEncoder().encode(JSON.stringify({sessionId:offer.sessionId,challenge,responseKey,operation:'oauth.import',input:{slot:'source',tokens:{accessToken:'private'}}}))).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM',typ:'portabase-confidential-command-v1'}).encrypt(await importJWK(offer.publicKey,'RSA-OAEP-256'))});
  assert.deepEqual(result,{operation:'oauth.import',received:'source'});
});
