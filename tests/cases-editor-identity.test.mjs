import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCasesEditorEmail} from '../scripts/lib/cases-editor-identity.mjs';
const ref='abcdefghijklmnopqrst', id='11111111-1111-4111-8111-111111111111';
test('operator email lookup binds exactly one confirmed account in the configured auth project', async()=>{
  const result=await resolveCasesEditorEmail(async(path,options)=>{
    assert.equal(path,`/projects/${ref}/database/query`);
    assert.equal(options.method,'POST');
    assert.equal(JSON.parse(options.body).query,"SELECT id, email, email_confirmed_at FROM auth.users WHERE lower(email) = 'owner@example.com' LIMIT 2");
    return [{id,email:'owner@example.com',email_confirmed_at:'2026-10-28T00:00:00Z'}];
  },ref,'Owner@example.com');
  assert.equal(result,id);
});
test('operator email lookup rejects ambiguous, unconfirmed, mismatched and malformed identities', async()=>{
  const valid={id,email:'owner@example.com',email_confirmed_at:'2026-10-28T00:00:00Z'};
  for(const rows of [[],[valid,valid],[{...valid,email_confirmed_at:null}],[{...valid,email:'other@example.com'}],[{...valid,id:'invalid'}]]) {
    await assert.rejects(resolveCasesEditorEmail(async()=>rows,ref,'owner@example.com'),/exactly_one_verified_editor_required/);
  }
  for(const email of ["owner' OR true--@example.com",'%@example.com','owner@example.com\n',' owner@example.com','owner']) {
    await assert.rejects(resolveCasesEditorEmail(async()=>{throw Error('must_not_query');},ref,email),/exact_editor_email_required/);
  }
});
