import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {CompactEncrypt,compactDecrypt,importJWK} from 'jose';
import {commandChannel,COMMAND_TYPE} from './command-channel.mjs';
const nonce=()=>randomBytes(32).toString('base64url');
const owner='a'.repeat(64),other='b'.repeat(64);
async function request(channel,operation='projects.list') {
  const challenge=nonce(),responseKey=nonce(),offer=await channel.offer(owner,challenge);
  const envelope=await new CompactEncrypt(new TextEncoder().encode(JSON.stringify({sessionId:offer.sessionId,challenge,responseKey,operation,input:{slot:'source'}})))
    .setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM',typ:COMMAND_TYPE}).encrypt(await importJWK(offer.publicKey,'RSA-OAEP-256'));
  return {body:{sessionId:offer.sessionId,envelope},responseKey};
}
test('cross-customer requests cannot consume an offer; responses are encrypted',async()=>{
  let calls=0;const channel=commandChannel({attest:async()=> 'fixture-only',dispatch:async()=>{calls++;return {privateInventory:'customer-only'};}});
  const req=await request(channel);
  await assert.rejects(channel.execute(other,req.body),/rejected/);assert.equal(calls,0);
  const response=await channel.execute(owner,req.body);
  assert.equal(calls,1);assert.ok(!JSON.stringify(response).includes('customer-only'));
  const result=JSON.parse(new TextDecoder().decode((await compactDecrypt(response.envelope,Buffer.from(req.responseKey,'base64url'))).plaintext));
  assert.equal(result.data.privateInventory,'customer-only');
  await assert.rejects(channel.execute(owner,req.body),/rejected/);assert.equal(calls,1);
});
test('expired requests and broken ciphertext do not reach the application',async()=>{
  let time=Date.now(),calls=0;const channel=commandChannel({now:()=>time,attest:async()=> 'fixture',dispatch:async()=>calls++});
  const req=await request(channel);time+=91000;
  await assert.rejects(channel.execute(owner,req.body),/rejected/);assert.equal(calls,0);
  const req2=await request(channel);req2.body.envelope=req2.body.envelope.slice(0,-8)+'AAAAAAAA';
  await assert.rejects(channel.execute(owner,req2.body),/rejected/);assert.equal(calls,0);
});
test('raw provider errors and credentials are not copied into responses',async()=>{
  const channel=commandChannel({attest:async()=> 'fixture',dispatch:async()=>{throw new Error('postgres://sensitive-password@host/private-table');}});
  const req=await request(channel);const response=await channel.execute(owner,req.body);
  const result=JSON.parse(new TextDecoder().decode((await compactDecrypt(response.envelope,Buffer.from(req.responseKey,'base64url'))).plaintext));
  assert.deepEqual({ok:result.ok,error:result.error},{ok:false,error:'operation_failed'});
});
