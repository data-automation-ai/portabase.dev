import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthConnections} from './oauth-connections.mjs';

test('failed token exchange preserves both grants and exposes only fixed diagnostic codes',async()=>{
  for(const [code,expected] of [['invalid_grant','invalid_grant'],
    ['private_token_material','oauth_token_request_failed']]) {
    const connections=oauthConnections({clientId:'client',clientSecret:'secret',
      redirectUri:'https://portabase.dev/confidential/callback',
      fetchImpl:async()=>({ok:false,status:400,json:async()=>({error:code,
        error_description:'private provider response with credential material'})})});
    const source={accessToken:'source'},target={accessToken:'target'};
    const profile={connections:{source,target}};
    const offer=connections.begin(profile,'target');
    await assert.rejects(connections.finish(profile,{slot:'target',state:offer.state,code:'fixture'}),
      error=>error.message===expected);
    assert.equal(profile.connections.source,source);
    assert.equal(profile.connections.target,target);
    assert.equal(profile.pending.target,undefined);
  }
});

test('separate Supabase OAuth slots reject the same account and accept a different one',async()=>{
  let destination='source';
  const fetchImpl=async(url,options)=>{
    if(url.endsWith('/oauth/token')){
      const code=new URLSearchParams(options.body).get('code');
      return {ok:true,json:async()=>({access_token:`access-token-for-${code}-long-enough`,
        refresh_token:`refresh-${code}`,expires_in:3600})};
    }
    if(url.endsWith('/profile')){
      const token=options.headers.Authorization;
      const account=token.includes('source')?'source':destination;
      return {ok:true,json:async()=>({gotrue_id:`id-${account}`,primary_email:`${account}@example.test`})};
    }
    throw new Error('unexpected_endpoint');
  };
  const connections=oauthConnections({clientId:'client',clientSecret:'secret',
    redirectUri:'https://portabase.dev/confidential/callback',fetchImpl});
  const profile={connections:{}};
  const source=connections.begin(profile,'source');
  await connections.finish(profile,{slot:'source',state:source.state,code:'source'});
  const same=connections.begin(profile,'target');
  await assert.rejects(connections.finish(profile,{slot:'target',state:same.state,code:'target'}),
    /destination_account_must_differ/);
  assert.equal(profile.connections.target,undefined);
  destination='destination';
  const separate=connections.begin(profile,'target');
  const connected=await connections.finish(profile,{slot:'target',state:separate.state,code:'target'});
  assert.equal(connected.identity.email,'destination@example.test');
  assert.deepEqual(await connections.assertDistinct(profile),{
    source:{id:'id-source',email:'source@example.test',verified:true},
    target:{id:'id-destination',email:'destination@example.test',verified:true},method:'provider',
  });
  destination='source';
  const reauthorize=connections.begin(profile,'target');
  await assert.rejects(connections.finish(profile,{slot:'target',state:reauthorize.state,code:'target'}),
    /destination_account_must_differ/);
  assert.equal((await connections.assertDistinct(profile)).method,'provider');
});

test('unavailable Management profile requires explicit grant-bound account confirmation',async()=>{
  const fetchImpl=async(url,options)=>url.endsWith('/profile')?{ok:false,status:403}
    :{ok:true,json:async()=>({access_token:`access-token-${new URLSearchParams(options.body).get('code')}-long-enough`,
      refresh_token:'refresh',expires_in:3600})};
  const connections=oauthConnections({clientId:'client',clientSecret:'secret',
    redirectUri:'https://portabase.dev/confidential/callback',fetchImpl});
  const profile={connections:{}};
  for(const slot of ['source','target']){
    const offer=connections.begin(profile,slot);
    await connections.finish(profile,{slot,state:offer.state,code:slot});
  }
  await assert.rejects(connections.assertDistinct(profile),/account_confirmation_required/);
  assert.throws(()=>connections.confirm(profile,{sourceEmail:'same@example.test',targetEmail:'same@example.test'}),
    /destination_account_must_differ/);
  connections.confirm(profile,{sourceEmail:'source@example.test',targetEmail:'target@example.test'});
  assert.equal((await connections.assertDistinct(profile)).method,'manual');
  connections.disconnect(profile,'target');
  await assert.rejects(connections.assertDistinct(profile),/supabase_connection_required/);
});

test('target begin() appends prompt=login while source does not', () => {
  const connections = oauthConnections({ clientId: 'client', clientSecret: 'secret',
    redirectUri: 'https://portabase.dev/confidential/callback' });
  const profile = { connections: {} };
  const source = connections.begin(profile, 'source');
  const target = connections.begin(profile, 'target');
  assert.equal(source.url.includes('prompt=login'), false);
  assert.equal(target.url.includes('prompt=login'), true);
});

test('connectToken accepts personal access token, verifies projects inside enclave, and enforces distinctness', async () => {
  let projectRequests = 0;
  const fetchImpl = async (url, options) => {
    if (url.endsWith('/projects')) {
      projectRequests++;
      return { ok: true, json: async () => [{ id: 'abcdefghijklmnopqrst', name: 'proj', region: 'us-east-1', status: 'ACTIVE_HEALTHY' }] };
    }
    if (url.endsWith('/profile')) {
      const auth = options?.headers?.Authorization || '';
      const isTarget = auth.includes('target');
      return { ok: true, json: async () => ({ gotrue_id: isTarget ? 'id-target' : 'id-source', primary_email: isTarget ? 'target@example.test' : 'source@example.test' }) };
    }
    throw new Error('unexpected_endpoint: ' + url);
  };
  const connections = oauthConnections({ clientId: 'client', clientSecret: 'secret',
    redirectUri: 'https://portabase.dev/confidential/callback', fetchImpl });
  const profile = { connections: {} };

  // Rejects invalid slot or malformed token
  await assert.rejects(connections.connectToken(profile, { slot: 'invalid', token: 'sbp_' + 'a'.repeat(40) }), /invalid_connection_slot/);
  await assert.rejects(connections.connectToken(profile, { slot: 'source', token: 'bad' }), /invalid_access_token/);

  // Connects source with sbp_...
  const sourceToken = 'sbp_' + '1'.repeat(40);
  const sourceRes = await connections.connectToken(profile, { slot: 'source', token: sourceToken });
  assert.equal(sourceRes.connected, true);
  assert.equal(sourceRes.method, 'token');
  assert.equal(profile.connections.source.tokenType, 'pat');
  assert.equal(profile.connections.source.accessToken, sourceToken);

  // Access works without refreshToken
  const access = await connections.access(profile, 'source');
  assert.equal(access.token, sourceToken);
  const projects = await access.api.projects();
  assert.equal(projects.length, 1);

  // Reject target with identical account
  const sameTargetToken = 'sbp_' + '1'.repeat(40);
  await assert.rejects(connections.connectToken(profile, { slot: 'target', token: sameTargetToken }),
    /destination_account_must_differ/);
  assert.equal(profile.connections.target, undefined);

  // Accept target with distinct account
  const targetToken = 'sbp_target_' + '2'.repeat(30);
  const targetRes = await connections.connectToken(profile, { slot: 'target', token: targetToken });
  assert.equal(targetRes.connected, true);
  assert.equal(targetRes.identity.email, 'target@example.test');
  assert.deepEqual(await connections.assertDistinct(profile), {
    source: { id: 'id-source', email: 'source@example.test', verified: true },
    target: { id: 'id-target', email: 'target@example.test', verified: true },
    method: 'provider',
  });
});

test('connectToken rejects token when Supabase projects API returns an error', async () => {
  const fetchImpl = async () => ({ ok: false, status: 401 });
  const connections = oauthConnections({ clientId: 'client', clientSecret: 'secret',
    redirectUri: 'https://portabase.dev/confidential/callback', fetchImpl });
  const profile = { connections: {} };
  await assert.rejects(connections.connectToken(profile, { slot: 'source', token: 'sbp_' + 'f'.repeat(40) }),
    /invalid_access_token/);
});
