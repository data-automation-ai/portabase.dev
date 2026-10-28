import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,compactDecrypt,CompactEncrypt} from 'jose';
import {createConfidentialSessionHandler} from '../netlify/functions/cloud-confidential-session.mjs';
import {sealSupabaseSession} from '../cloud/runner/oauth-session-cookie.mjs';
const now=Date.parse('2026-10-28T00:00:00Z'),secret='fixture-cookie-key-at-least-sixteen';
const user={id:'customer-a',cloudVersion:'supabase',emailVerified:true};
const nonce='a'.repeat(43),sessionId='b'.repeat(43);
const grant={accessToken:'fixture-access-token',refreshToken:'fixture-refresh-token',expiresAt:now+3600000};
function db(){const rows=new Map();let revision=0;return {getWithMetadata:async k=>structuredClone(rows.get(k)||null),setJSON:async(k,data,condition)=>{const old=rows.get(k);if(condition.onlyIfNew?!!old:condition.onlyIfMatch!==old?.etag)return {modified:false};rows.set(k,{data,etag:String(++revision)});return {modified:true};}};}
function fixture(extra={}){const store=db();return {store,options:{authenticate:async()=>user,configuration:async()=>({usageImageDigest:'sha256:'+'a'.repeat(64)}),database:()=>store,initialize:async()=>{},secret:()=>secret,clock:()=>now,...extra}};}
const request=(method,body,headers={})=>({httpMethod:method,body:JSON.stringify(body),headers});
const cookie=(session=grant)=>'pb_oauth_sb_source_token='+encodeURIComponent(JSON.stringify(sealSupabaseSession(session,secret)));
const bridge={action:'bridge',provider:'supabase',slot:'source',offer:{sessionId},challenge:nonce,responseKey:'c'.repeat(43)};

test('bridge verifies attestation before encrypting exact renewable grant; never returns raw tokens',async()=>{
 const pair=await generateKeyPair('RSA-OAEP-256',{modulusLength:3072});let verified=false;
 const {options}=fixture({verify:async()=>{verified=true;return {encryptionKey:pair.publicKey};}});
 const run=createConfidentialSessionHandler(options),headers={cookie:cookie()};
 const response=await run(request('POST',bridge,headers));assert.equal(response.statusCode,200);assert.equal(verified,true);
 assert.doesNotMatch(response.body,/fixture-access-token|fixture-refresh-token|recoveryKey/);
 const result=JSON.parse(response.body),decoded=await compactDecrypt(result.envelope,pair.privateKey);
 const payload=JSON.parse(Buffer.from(decoded.plaintext));
 assert.equal(payload.operation,'oauth.import');assert.deepEqual(payload.input,{slot:'source',session:grant});
 assert.equal(payload.sessionId,sessionId);assert.equal(payload.challenge,nonce);assert.equal(payload.responseKey,bridge.responseKey);
 const completed=await run(request('POST',{action:'complete-bridge',provider:'supabase',slot:'source',bridgeId:result.bridgeId},headers));
 assert.equal(completed.statusCode,200);assert.equal(completed.multiValueHeaders['Set-Cookie'].length,2);
 assert.match(completed.multiValueHeaders['Set-Cookie'][0],/Max-Age=0/);
 const changed=await run(request('POST',{action:'complete-bridge',provider:'supabase',slot:'source',bridgeId:result.bridgeId},{cookie:cookie({...grant,accessToken:'new-grant'})}));
 assert.equal(changed.statusCode,409);
});

test('unverified evidence, wrong origin, plaintext recovery key and missing policy all fail closed',async()=>{
 const {options}=fixture({verify:async()=>{throw Error('bad signature');}}),run=createConfidentialSessionHandler(options);
 assert.equal((await run(request('POST',bridge,{cookie:cookie()}))).statusCode,403);
 assert.equal((await run(request('POST',bridge,{cookie:cookie(),origin:'https://attacker.example'}))).statusCode,403);
 assert.equal((await run(request('POST',{...bridge,recoveryKey:'should-not-be-sent'},{cookie:cookie()}))).statusCode,400);
 const unavailable=createConfidentialSessionHandler({...options,configuration:async()=>({})});
 assert.equal((await unavailable(request('GET'))).statusCode,503);
});

test('opaque encrypted profile is owner-bound and CAS prevents stale tabs from rolling it back',async()=>{
 const {options}=fixture(),run=createConfidentialSessionHandler(options);
 const key=crypto.getRandomValues(new Uint8Array(32));
 const sealedProfile=await new CompactEncrypt(new TextEncoder().encode('private profile')).setProtectedHeader({alg:'dir',enc:'A256GCM',typ:'portabase-customer-connections-v1'}).encrypt(key);
 const before=JSON.parse((await run(request('GET'))).body);assert.equal(before.sealedProfile,null);
 const first=await run(request('PUT',{sealedProfile,profileRevision:null}));assert.equal(first.statusCode,200);
 const revision=JSON.parse(first.body).profileRevision;
 assert.equal((await run(request('PUT',{sealedProfile,profileRevision:null}))).statusCode,409);
 assert.equal((await run(request('PUT',{sealedProfile,profileRevision:revision}))).statusCode,200);
 const other=createConfidentialSessionHandler({...options,authenticate:async()=>({...user,id:'customer-b'})});
 assert.equal(JSON.parse((await other(request('GET'))).body).sealedProfile,null);
 assert.equal((await run(request('PUT',{sealedProfile:'plaintext-key',profileRevision:revision}))).statusCode,400);
});


test('legacy Dropbox cookies without expiry are refreshed before encrypted import',async()=>{
 const pair=await generateKeyPair('RSA-OAEP-256',{modulusLength:3072});let refreshed=false;
 const {options}=fixture({verify:async()=>({encryptionKey:pair.publicKey}),refreshDropbox:async()=>{refreshed=true;return {...grant,expiresAt:now+14400000};}});
 const body={...bridge,provider:'dropbox',slot:'vault'};
 const response=await createConfidentialSessionHandler(options)(request('POST',body,{cookie:'pb_oauth_dropbox_token='+encodeURIComponent(JSON.stringify({accessToken:grant.accessToken,refreshToken:grant.refreshToken,clientId:'fixture-app'}))}));
 assert.equal(response.statusCode,200);assert.equal(refreshed,true);
 const decoded=await compactDecrypt(JSON.parse(response.body).envelope,pair.privateKey);
 const payload=JSON.parse(Buffer.from(decoded.plaintext));assert.equal(payload.operation,'vault.import');assert.equal(payload.input.session.expiresAt,now+14400000);
 assert.equal(response.multiValueHeaders['Set-Cookie'].length,1);
});
