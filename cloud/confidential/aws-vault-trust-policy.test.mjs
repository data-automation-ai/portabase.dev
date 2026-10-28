import test from 'node:test';
import assert from 'node:assert/strict';
import {awsVaultTrustPolicy} from './aws-vault-trust-policy.mjs';
test('AWS vault trust pins reviewed image, TDX, project, zone, audience and exact stable support values',()=>{
  const digest='sha256:'+'a'.repeat(64),policy=awsVaultTrustPolicy('123456789012',digest,'b'.repeat(64));
  const statement=policy.Statement[0],equals=statement.Condition.StringEquals;
  assert.equal(statement.Principal.Federated,'arn:aws:iam::123456789012:oidc-provider/confidentialcomputing.googleapis.com');
  assert.deepEqual(statement.Action,['sts:AssumeRoleWithWebIdentity','sts:TagSession']);
  assert.equal(equals['aws:RequestTag/container.image_digest'],digest);
  assert.equal(equals['aws:RequestTag/hwmodel'],'GCP_INTEL_TDX');
  assert.equal(equals['aws:RequestTag/gce.project_id'],'portabase-dev');
  assert.equal(equals['confidentialcomputing.googleapis.com:aud'],'https://portabase.dev/vault/'+'b'.repeat(64));
  assert.deepEqual(equals['aws:RequestTag/confidential_space.support_attributes'],['LATEST=STABLE=USABLE','STABLE=USABLE']);
  assert.throws(()=>awsVaultTrustPolicy('123','latest'),/reviewed/);
});
