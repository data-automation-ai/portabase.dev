// Reviewable policy generator only; never calls AWS or modifies existing IAM.
// node cloud/confidential/aws-vault-trust-policy.mjs ACCOUNT_ID sha256:DIGEST OWNER_HASH
import {pathToFileURL} from 'node:url';
export function awsVaultTrustPolicy(accountId,digest,owner){
  if(!/^\d{12}$/.test(accountId)||!/^sha256:[a-f0-9]{64}$/.test(digest)||! /^[a-f0-9]{64}$/.test(owner||''))throw Error('reviewed_account_and_image_required');
  return {Version:'2012-10-17',Statement:[{Effect:'Allow',
    Principal:{Federated:`arn:aws:iam::${accountId}:oidc-provider/confidentialcomputing.googleapis.com`},
    Action:['sts:AssumeRoleWithWebIdentity','sts:TagSession'],
    Condition:{StringEquals:{
      'confidentialcomputing.googleapis.com:aud':`https://portabase.dev/vault/${owner}`,
      'aws:RequestTag/swname':'CONFIDENTIAL_SPACE',
      'aws:RequestTag/container.image_digest':digest,
      'aws:RequestTag/gce.project_id':'portabase-dev',
      'aws:RequestTag/gce.zone':'us-central1-a',
      'aws:RequestTag/hwmodel':'GCP_INTEL_TDX',
      'aws:RequestTag/confidential_space.support_attributes':['LATEST=STABLE=USABLE','STABLE=USABLE'],
    }}}]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  process.stdout.write(JSON.stringify(awsVaultTrustPolicy(process.argv[2],process.argv[3],process.argv[4]),null,2)+'\n');
