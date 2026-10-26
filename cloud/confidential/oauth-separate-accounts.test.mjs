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
