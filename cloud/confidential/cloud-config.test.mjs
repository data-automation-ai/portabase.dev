import test from 'node:test';
import assert from 'node:assert/strict';
import {admissionEndpoint} from './cloud-config.mjs';
test('admission accepts the product endpoint and an immutable product draft',()=>{
 assert.equal(admissionEndpoint(''),'https://portabase.dev/api/cloud/confidential-admission');
 const draft='https://6add65d46a627f9794dba0ab--portabase-dev.netlify.app/.netlify/functions/cloud-confidential-admission';
 assert.equal(admissionEndpoint(draft),draft);
});
test('admission rejects arbitrary hosts, credentials, insecure URLs and query suffixes',()=>{
 for(const value of ['http://portabase.dev/api/cloud/confidential-admission',
 'https://evil.example/.netlify/functions/cloud-confidential-admission',
 'https://user:pass@portabase.dev/api/cloud/confidential-admission',
 'https://portabase.dev/api/cloud/confidential-admission?redirect=evil',
 'https://6add65d46a627f9794dba0ab--other.netlify.app/.netlify/functions/cloud-confidential-admission']){
  assert.throws(()=>admissionEndpoint(value),/unapproved_admission_endpoint/);
 }
});
