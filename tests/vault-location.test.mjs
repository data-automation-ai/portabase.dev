import test from 'node:test';
import assert from 'node:assert/strict';
import {validateVaultLocation} from '../src/console/vault-location.mjs';

test('S3 and R2 locations retain explicit bucket, folder and naming choice',()=>{
  assert.deepEqual(validateVaultLocation('s3',{bucket:'portabase-capsules-899867382621',prefix:'/Portabase/capsules/',naming:'overwrite',region:'us-east-1'}),
    {bucket:'portabase-capsules-899867382621',prefix:'Portabase/capsules',naming:'overwrite',region:'us-east-1'});
  assert.deepEqual(validateVaultLocation('r2',{bucket:'portabase-capsules',prefix:'client-1/backups',naming:'date-stamped',accountId:'a'.repeat(32)}),
    {bucket:'portabase-capsules',prefix:'client-1/backups',naming:'date-stamped',accountId:'a'.repeat(32)});
});

test('location settings reject traversal and malformed destinations',()=>{
  for(const value of ['../capsules','Portabase//capsules','Portabase/../capsules'])
    assert.throws(()=>validateVaultLocation('s3',{bucket:'portabase-capsules',prefix:value,naming:'overwrite'}));
  assert.throws(()=>validateVaultLocation('r2',{bucket:'portabase-capsules',prefix:'capsules',naming:'overwrite',accountId:'wrong'}));
  assert.throws(()=>validateVaultLocation('s3',{bucket:'UPPER CASE',prefix:'capsules',naming:'overwrite'}));
});
