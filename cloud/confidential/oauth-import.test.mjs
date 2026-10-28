import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthConnections} from './oauth-connections.mjs';
import {dropboxVault} from './dropbox-vault.mjs';
const at=Date.parse('2026-10-28T00:00:00Z');
const session={accessToken:'synthetic-access-token-for-test',refreshToken:'synthetic-refresh',expiresAt:at+3600000};
test('OAuth import validates identity and retains refresh/expiry inside profile only',async()=>{
  let identity='first';const c=oauthConnections({clientId:'synthetic',clientSecret:'synthetic',redirectUri:'https://portabase.dev/confidential/callback',now:()=>at,
    fetchImpl:async url=>Response.json(url.endsWith('/profile')?{gotrue_id:identity,primary_email:identity+'@example.test'}:[])});
  const profile={connections:{}};const result=await c.importSession(profile,{slot:'source',session});
  assert.equal(profile.connections.source.refreshToken,session.refreshToken);assert.equal(profile.connections.source.expiresAt,session.expiresAt);
  assert.ok(!JSON.stringify(result).includes('synthetic-refresh'));assert.equal(result.identity.verified,true);
  await assert.rejects(c.importSession(profile,{slot:'target',session}),/destination_account_must_differ/);assert.equal(profile.connections.target,undefined);
  identity='second';await c.importSession(profile,{slot:'target',session});assert.equal(profile.connections.target.tokenType,'bearer');
  await assert.rejects(c.importSession(profile,{slot:'source',session:{...session,expiresAt:at-1}}),/invalid_oauth_session/);
  await assert.rejects(c.importSession(profile,{slot:'source',session:{...session,identity:{verified:true}}}),/invalid_oauth_session/);
});
test('Dropbox import checks live account and preserves renewable session without reflecting secrets',async()=>{
  const vault=dropboxVault({clientId:'synthetic-app',now:()=>at,fetchImpl:async url=>Response.json(url.endsWith('/get_current_account')?{account_id:'synthetic-account',name:{display_name:'Fixture'}}:{used:0,allocation:{allocated:1024}})});
  const profile={};const result=await vault.importSession(profile,{provider:'dropbox',session});
  assert.equal(profile.activeVault,'dropbox');assert.equal(profile.dropbox.refreshToken,session.refreshToken);assert.ok(!JSON.stringify(result).includes('synthetic-refresh'));
  await assert.rejects(vault.importSession(profile,{provider:'other',session}),/invalid_dropbox_session/);
});
