import test from 'node:test';
import assert from 'node:assert/strict';
import {oauthConnections} from './oauth-connections.mjs';

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
    source:{id:'id-source',email:'source@example.test'},
    target:{id:'id-destination',email:'destination@example.test'},
  });
  destination='source';
  await assert.rejects(connections.assertDistinct(profile),/destination_account_must_differ/);
});
