import { verifyCloudUser,jsonResponse } from '../shared/verify-user.mjs';
import { getSubscriptionForUser } from '../shared/subscription-store.mjs';
import { runnerAdmission } from '../shared/runner-admission.mjs';
import { verifyUsageAttestation } from '../../cloud/confidential/usage-attestation.mjs';
import { createHash } from 'node:crypto';
import { runtimePolicy } from '../shared/runtime-policy.mjs';
import { applyUsage,usageDatabase,usageKey,usageSummary,validateUsageCommand } from '../shared/confidential-usage.mjs';

export function createConfidentialUsageHandler({authenticate=verifyCloudUser,subscription=getSubscriptionForUser,
  database=usageDatabase,verify=verifyUsageAttestation,clock=Date.now,
  imageDigest=process.env.PORTABASE_CONFIDENTIAL_USAGE_IMAGE_DIGEST,configuration=runtimePolicy}={}) {
  return async event=>{
    if(!['GET','POST'].includes(event.httpMethod))return jsonResponse(405,{error:'method_not_allowed'});
    let user;try{user=await authenticate(event);}catch{return jsonResponse(401,{error:'unauthorized'});}
    if(user.cloudVersion!=='supabase'||!user.emailVerified)return jsonResponse(403,{error:'verified_account_required'});
    try{
      const plan=runnerAdmission(await subscription(user),clock()).plan;
      const db=database(),key=usageKey(user);
      if(event.httpMethod==='GET'){
        const old=await db.getWithMetadata(key,{type:'json'});
        return jsonResponse(200,{ok:true,usage:usageSummary(old?.data,{now:clock(),allowanceBytes:plan.transferAllowanceBytes??null})});
      }
      if(Buffer.byteLength(event.body||'')>50000)return jsonResponse(413,{error:'body_too_large'});
      let input;try{input=JSON.parse(event.body);}catch{return jsonResponse(400,{error:'invalid_json'});}
      if(!input||Object.keys(input).some(k=>!['command','offer'].includes(k)))return jsonResponse(400,{error:'invalid_usage'});
      validateUsageCommand(input.command);
      const approvedImage=imageDigest||(await configuration()).usageImageDigest;
      if(!/^sha256:[a-f0-9]{64}$/.test(approvedImage||''))return jsonResponse(503,{error:'usage_attestation_not_configured'});
      const challenge=createHash('sha256').update(user.id+'\n'+JSON.stringify(input.command)).digest('base64url');
      try{await verify(input.offer,challenge,{imageDigest:approvedImage,projectNumber:'495102144848',hardware:'GCP_INTEL_TDX',workload:'application'});}
      catch{return jsonResponse(403,{error:'usage_attestation_rejected'});}
      const usage=await applyUsage(db,key,input.command,{now:clock(),plan});
      return jsonResponse(200,{ok:true,usage});
    }catch(error){return jsonResponse(error.status||503,{error:error.code||'usage_service_unavailable'});}
  };
}
const usageHandler=createConfidentialUsageHandler();
// Native v2 retains the regional context needed for strongly consistent Blobs reads.
export default async function handler(request) {
  const result=await usageHandler({httpMethod:request.method,headers:Object.fromEntries(request.headers),body:request.method==='POST'?await request.text():''});
  return new Response(result.body,{status:result.statusCode,headers:result.headers});
}
