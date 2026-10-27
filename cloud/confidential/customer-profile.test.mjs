import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sealProfile,openProfile} from './customer-profile.mjs';
test('OAuth tokens persist only encrypted and remain bound to the customer',async()=>{
  const key=randomBytes(32).toString('base64url'),owner='a'.repeat(64);
  const profile={version:1,owner,connections:{source:{accessToken:'synthetic-access',refreshToken:'synthetic-refresh'}}};
  const sealed=await sealProfile(profile,key);
  assert.ok(!sealed.includes('synthetic'));assert.deepEqual(await openProfile(sealed,key,owner),profile);
  await assert.rejects(openProfile(sealed,key,'b'.repeat(64)),/profile_unlock_failed/);
  await assert.rejects(openProfile(sealed,randomBytes(32).toString('base64url'),owner),/profile_unlock_failed/);
  await assert.rejects(openProfile(sealed.slice(0,-10)+'AAAAAAAAAA',key,owner),/profile_unlock_failed/);
});
