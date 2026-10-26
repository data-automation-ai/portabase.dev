import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {uploadCapsuleToDropbox,computeDropboxContentHash} from '../utility/cloud-storage-connectors.mjs';

test('delivery counts only acknowledged verified files and never leaks paths into telemetry',async()=>{
  if(/^f:/i.test(tmpdir()))throw new Error('Forbidden fixture path');
  const dir=await mkdtemp(join(tmpdir(),'pb-delivery-unit-'));
  try {
    await writeFile(join(dir,'one.txt'),'abc');await writeFile(join(dir,'two.txt'),'defgh');
    const events=[];
    const result=await uploadCapsuleToDropbox(dir,{accessToken:'fixture-token',onProgress:event=>events.push(event),
      fetchImpl:async(url,options)=>({ok:true,json:async()=>({size:options.body.length,
        content_hash:computeDropboxContentHash(options.body)})})});
    assert.equal(result.verified,true);
    assert.deepEqual(events.at(-1),{bytesReceived:8,totalBytes:8,verifiedBytes:8});
    assert.deepEqual(events[0],{bytesReceived:0,totalBytes:8,verifiedBytes:0});
    assert.ok(events.every(event=>Object.keys(event).sort().join(',')==='bytesReceived,totalBytes,verifiedBytes'));
    const failed=[];
    await assert.rejects(uploadCapsuleToDropbox(dir,{accessToken:'fixture-token',onProgress:event=>failed.push(event),
      fetchImpl:async()=>({ok:true,json:async()=>({size:3,content_hash:'wrong'})})}),/content_hash mismatch/);
    assert.deepEqual(failed,[{bytesReceived:0,totalBytes:8,verifiedBytes:0}]);
  }finally{await rm(dir,{recursive:true,force:true});}
});
