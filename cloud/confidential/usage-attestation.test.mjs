import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT} from 'jose';
import {verifyUsageAttestation,USAGE_AUDIENCE} from './usage-attestation.mjs';
import {ISSUER,AUDIENCE,APPLICATION_ENTRYPOINT} from './attestation.mjs';
const policy={imageDigest:'sha256:'+'a'.repeat(64),projectNumber:'495102144848',hardware:'GCP_INTEL_TDX',workload:'application'};
test('valid generic attestation cannot forge usage, while dedicated audience binds image and exact payload',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256'),challenge='b'.repeat(43);
  const claims={swname:'CONFIDENTIAL_SPACE',secboot:true,dbgstat:'disabled-since-boot',hwmodel:'GCP_INTEL_TDX',
    submods:{gce:{project_number:policy.projectNumber},confidential_space:{support_attributes:['STABLE','USABLE']},
      container:{image_digest:policy.imageDigest,args:APPLICATION_ENTRYPOINT,restart_policy:'Never'}},
    eat_nonce:[challenge,'portabase-usage-meter-v1']};
  const sign=(audience,payload=claims)=>new SignJWT(payload).setProtectedHeader({alg:'RS256'}).setIssuer(ISSUER)
    .setAudience(audience).setSubject('runner').setIssuedAt().setNotBefore('0s').setExpirationTime('90s').sign(privateKey);
  await assert.rejects(verifyUsageAttestation({attestation:await sign(AUDIENCE)},challenge,policy,{keyResolver:publicKey}));
  const signed=await sign(USAGE_AUDIENCE);
  assert.equal(await verifyUsageAttestation({attestation:signed},challenge,policy,{keyResolver:publicKey}),true);
  await assert.rejects(verifyUsageAttestation({attestation:signed},'c'.repeat(43),policy,{keyResolver:publicKey}));
  await assert.rejects(verifyUsageAttestation({attestation:signed},challenge,{...policy,imageDigest:'sha256:'+'d'.repeat(64)},{keyResolver:publicKey}));
});
