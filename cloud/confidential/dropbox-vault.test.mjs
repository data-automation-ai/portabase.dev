import test from 'node:test';
import assert from 'node:assert/strict';
import {dropboxVault} from './dropbox-vault.mjs';

test('Dropbox grant is exchanged inside the vault and yields refresh-only upload config',async()=>{
  const calls=[],fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/oauth2/token'))return {ok:true,json:async()=>({access_token:'access',refresh_token:'refresh',expires_in:14400,account_id:'dbid:test'})};
    if(url.endsWith('/2/users/get_current_account'))return {ok:true,json:async()=>({account_id:'dbid:test',name:{display_name:'Tester'}})};
    if(url.endsWith('/2/users/get_space_usage'))return {ok:true,json:async()=>({used:0,allocation:{allocated:20*1024**3}})};
    throw new Error('unexpected request');
  };
  const vault=dropboxVault({clientId:'dropbox_app_123',fetchImpl});
  const profile={};
  const offer=vault.begin(profile);
  assert.equal(new URL(offer.url).searchParams.has('redirect_uri'),false);
  await assert.rejects(vault.finish(profile,'short'),/dropbox_oauth_invalid/);
  await vault.finish(profile,'authorization_code_123');
  assert.equal(profile.dropbox.refreshToken,'refresh');
  const provider=await vault.provider(profile);
  assert.equal(provider.type,'dropbox');
  assert.equal(provider.refreshToken,'refresh');
  assert.equal('accessToken' in provider,false);
  const exchange=calls.find(call=>call.url.endsWith('/oauth2/token'));
  assert.equal(new URLSearchParams(exchange.options.body).has('redirect_uri'),false);
});

test('Dropbox grant with redirect_uri validates callback, verifies state, and exchanges with redirect_uri', async () => {
  const calls = [], fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh', expires_in: 14400, account_id: 'dbid:test' }) };
    if (url.endsWith('/2/users/get_current_account')) return { ok: true, json: async () => ({ account_id: 'dbid:test', name: { display_name: 'Tester' } }) };
    if (url.endsWith('/2/users/get_space_usage')) return { ok: true, json: async () => ({ used: 0, allocation: { allocated: 20 * 1024 ** 3 } }) };
    throw new Error('unexpected request');
  };
  const vault = dropboxVault({ clientId: 'dropbox_app_123', fetchImpl });
  const profile = {};
  assert.throws(() => vault.begin(profile, 'https://evil.com/callback'), /invalid_oauth_callback/);
  const offer = vault.begin(profile, 'http://localhost:58441/oauth/dropbox/callback');
  assert.equal(new URL(offer.url).searchParams.get('redirect_uri'), 'http://localhost:58441/oauth/dropbox/callback');
  assert.equal(offer.redirectUri, 'http://localhost:58441/oauth/dropbox/callback');
  assert.ok(offer.state);
  await assert.rejects(vault.finish(profile, { code: 'authorization_code_123', state: 'wrong_state' }), /dropbox_oauth_state_mismatch/);
  await vault.finish(profile, { code: 'authorization_code_123', state: offer.state });
  assert.equal(profile.dropbox.refreshToken, 'refresh');
  const exchange = calls.find(call => call.url.endsWith('/oauth2/token'));
  assert.equal(new URLSearchParams(exchange.options.body).get('redirect_uri'), 'http://localhost:58441/oauth/dropbox/callback');
});
