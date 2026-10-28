import test from 'node:test';
import assert from 'node:assert/strict';
import {r2Endpoint,r2Vault} from './r2-vault.mjs';

test('R2 uses the selected account endpoint and bucket without exposing credentials in connection result',async()=>{
  const accountId='a'.repeat(32),requests=[];
  const vault=r2Vault({fetchImpl:async(url,options)=>{requests.push([url,options.headers.Authorization]);return {ok:true,text:async()=>'<ListBucketResult/>'};}});
  const profile={};
  const result=await vault.connect(profile,{accountId,bucket:'capsules',prefix:'Portabase/capsules',accessKeyId:'test-id',secretAccessKey:'test-secret'});
  assert.deepEqual(result,{connected:true,bucket:'capsules',prefix:'Portabase/capsules',accountId});
  assert.match(requests[0][0],/^https:\/\/a{32}\.r2\.cloudflarestorage\.com\/capsules\//);
  assert.match(requests[0][1],/\/auto\/s3\/aws4_request/);
  assert.equal((await vault.provider(profile)).type,'r2');
  assert.equal(JSON.stringify(result).includes('test-secret'),false);
  assert.throws(()=>r2Endpoint('wrong'),/invalid_r2_account_id/);
});
