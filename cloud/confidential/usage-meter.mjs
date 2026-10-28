// Executes inside the attested workload. Never expose this as a browser telemetry write API.
import { createHash } from 'node:crypto';
import { requestUsageAttestation } from './usage-attestation.mjs';
export const usageChallenge = (userId,command) => createHash('sha256').update(userId+'\n'+JSON.stringify(command)).digest('base64url');

export function createUsageMeter({authorization,requestId,projectRef,kind='backup',binaryMode='none',
  fetchImpl=fetch,attest=requestUsageAttestation,endpoint='https://portabase.dev/api/cloud/confidential-usage'}={}) {
  if (endpoint !== 'https://portabase.dev/api/cloud/confidential-usage') throw Error('unapproved_usage_endpoint');
  // This is only a binding hint. The API independently verifies the bearer token.
  let subject;
  try { subject=JSON.parse(Buffer.from(authorization.replace(/^Bearer /,'').split('.')[1],'base64url')).sub; } catch {}
  if(typeof subject!=='string'||!subject)throw Error('usage_authorization_required');
  async function send(operation,values) {
    const command={operation,requestId,projectRef,kind,binaryMode,...values};
    const challenge=usageChallenge(subject,command);
    const offer={attestation:await attest(challenge)};
    const response=await fetchImpl(endpoint,{method:'POST',headers:{Authorization:authorization,
      'content-type':'application/json','x-portabase-cloud-version':'supabase'},
      body:JSON.stringify({command,offer}),redirect:'error',signal:AbortSignal.timeout(30000)});
    const result=await response.json();
    if(!response.ok)throw Error(/^[a-z_]{3,80}$/.test(result.error||'')?result.error:'usage_service_unavailable');
    return result.usage;
  }
  return {
    abort:()=>send('abort',{databaseBytes:0,binaryBytes:0,otherBytes:0}),
    reserve:({databaseBytes=0,binaryBytes=0,otherBytes=0}={})=>send('reserve',{databaseBytes,binaryBytes,otherBytes}),
    finish:({databaseBytes=0,binaryBytes=0,otherBytes=0,status,durationMs,completeness='unverified',verified=false,
      manifestVerified=false,binarySnapshotId,binaryBaselineId}={})=>send('finish',{
        databaseBytes,binaryBytes,otherBytes,status,durationMs,completeness,verified,manifestVerified,
        ...(binarySnapshotId?{binarySnapshotId}:{}),...(binaryBaselineId?{binaryBaselineId}:{})}),
  };
}
