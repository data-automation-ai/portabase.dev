import { getStore, connectLambda } from '@netlify/blobs';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { getSubscriptionForUser } from '../shared/subscription-store.mjs';
import { runnerAdmission } from '../shared/runner-admission.mjs';
import { planTransfersPer24h } from '../shared/product.mjs';
import { createHash } from 'node:crypto';
export function confidentialAdmission({authenticate=verifyCloudUser,subscription=getSubscriptionForUser,database,clock=Date.now}={}) {
  return async event=>{
    if(event.httpMethod!=='POST') return jsonResponse(405,{error:'method_not_allowed'});
    let user;try{user=await authenticate(event);}catch{return jsonResponse(401,{error:'unauthorized'});}
    if(user.cloudVersion!=='supabase' || !user.emailVerified) return jsonResponse(403,{error:'verified_account_required'});
    let body;try{body=JSON.parse(event.body||'');}catch{return jsonResponse(400,{error:'invalid_json'});}
    if(!body || typeof body!=='object' || Array.isArray(body))return jsonResponse(400,{error:'invalid_request'});
    if(Buffer.byteLength(event.body||'')>2048 || !['backup.start','restore.start','quota.inspect','runner.start'].includes(body.operation) || !/^[a-f0-9-]{36}$/i.test(body.requestId||'')
      || Object.keys(body).some(k=>!['operation','requestId'].includes(k)))return jsonResponse(400,{error:'invalid_request'});
    try {
      if(event.blobs)connectLambda(event);
      const admission=runnerAdmission(await subscription(user),clock());
      const maxBytes=admission.plan.storageCapBytes;
      const dailyLimit=admission.paid?planTransfersPer24h(admission.plan.id,{extraTransfersAddon:admission.extraTransfersAddon}):1;
      if(['restore.start','quota.inspect'].includes(body.operation)) return jsonResponse(200,{maxBytes,plan:admission.plan.id});
      const counter=body.operation==='runner.start'?'starts':'runs';
      // No disk or in-memory fallback: quotas must survive instance restarts.
      const db=database?database():getStore({name:'portabase-confidential-admission',consistency:'strong'});
      const key=createHash('sha256').update(`${user.cloudVersion}:${user.id}`).digest('hex');
      for(let attempt=0;attempt<5;attempt++) {
        const old=await db.getWithMetadata(key,{type:'json'}), now=clock();
        const recent=(old?.data?.[counter]||[]).filter(r=>r.at>now-86400000);
        if(recent.some(r=>r.id===body.requestId)) return jsonResponse(409,{error:'request_already_admitted'});
        if(recent.length>=dailyLimit) return jsonResponse(429,{error:'daily_limit_reached',nextAvailableAt:new Date(Math.min(...recent.map(r=>r.at))+86400000).toISOString()});
        const result=await db.setJSON(key,{...old?.data,[counter]:[...recent,{id:body.requestId,at:now}]},old?{onlyIfMatch:old.etag}:{onlyIfNew:true});
        if(result.modified) return jsonResponse(200,{maxBytes,plan:admission.plan.id,requestId:body.requestId});
      }
      return jsonResponse(409,{error:'admission_busy'});
    } catch { return jsonResponse(503,{error:'quota_service_unavailable'}); }
  };
}
const admission=confidentialAdmission();
// Native Functions v2 supplies the regional Blobs context required for strong
// reads. Legacy connectLambda discards uncachedEdgeURL and cannot supply it.
export default async function handler(request) {
  const result=await admission({httpMethod:request.method,headers:Object.fromEntries(request.headers),
    body:request.method==='POST'?await request.text():''});
  return new Response(result.body,{status:result.statusCode,headers:result.headers});
}
