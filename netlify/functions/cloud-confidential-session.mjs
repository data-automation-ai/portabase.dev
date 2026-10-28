import {createHmac,timingSafeEqual} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {CompactEncrypt,decodeProtectedHeader} from 'jose';
import {verifyCloudUser,jsonResponse} from '../shared/verify-user.mjs';
import {runtimePolicy} from '../shared/runtime-policy.mjs';
import {usageKey} from '../shared/confidential-usage.mjs';
import {initializeHostedOAuth} from '../shared/hosted-oauth-config.mjs';
import {openSupabaseSession,sealSupabaseSession} from '../../cloud/runner/oauth-session-cookie.mjs';
import {refreshDropboxOAuthToken} from '../../cloud/runner/storage-oauth.mjs';
import {refreshSupabaseAccessToken} from '../../cloud/runner/supabase-oauth.mjs';
import {verifyOffer} from '../../cloud/confidential/attestation.mjs';
const CONTROLLER='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const TYPE='portabase-confidential-command-v1';
const NONCE=/^[A-Za-z0-9_-]{43}$/;
const fail=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const header=(event,name)=>Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()===name)?.[1];
function cookie(event,name){const raw=header(event,'cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));try{return raw?JSON.parse(decodeURIComponent(raw.slice(name.length+1))):null;}catch{return null;}}
const cookieName=(provider,slot)=>provider==='dropbox'?'pb_oauth_dropbox_token':`pb_oauth_sb_${slot}_token`;
const serialize=(name,value,maxAge)=>`${name}=${value==null?'':encodeURIComponent(JSON.stringify(value))}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
function validProfile(value){
  try{const h=decodeProtectedHeader(value),parts=value.split('.');return typeof value==='string'&&value.length<=131072&&parts.length===5&&parts[1]===''&&parts[2].length===16&&parts[3].length>0&&parts[4].length===22&&parts.every(x=>/^[A-Za-z0-9_-]*$/.test(x))&&h.alg==='dir'&&h.enc==='A256GCM'&&h.typ==='portabase-customer-connections-v1'&&Object.keys(h).length===3;}catch{return false;}
}
export function createConfidentialSessionHandler({authenticate=verifyCloudUser,configuration=runtimePolicy,
 database=()=>getStore({name:'portabase-confidential-profiles',consistency:'strong'}),initialize=initializeHostedOAuth,
 secret=()=>process.env.PORTABASE_OAUTH_COOKIE_SECRET||process.env.SUPABASE_OAUTH_CLIENT_SECRET||'',verify=verifyOffer,
 refresh=refreshSupabaseAccessToken,refreshDropbox=refreshDropboxOAuthToken,clock=Date.now}={}) {
 return async event=>{
  if(!['GET','PUT','POST'].includes(event.httpMethod))return jsonResponse(405,{error:'method_not_allowed'});
  let user;try{user=await authenticate(event);}catch{return jsonResponse(401,{error:'unauthorized'});}
  if(user.cloudVersion!=='supabase'||!user.emailVerified)return jsonResponse(403,{error:'verified_account_required'});
  try{
   const origin=header(event,'origin');if(origin&&origin!=='https://portabase.dev')fail('origin_rejected',403);
   const config=await configuration();
   const imageDigest=process.env.PORTABASE_CONFIDENTIAL_USAGE_IMAGE_DIGEST||config.usageImageDigest;
   if(!/^sha256:[a-f0-9]{64}$/.test(imageDigest||''))fail('confidential_policy_unavailable',503);
   const policy={imageDigest,projectNumber:'495102144848',hardware:'GCP_INTEL_TDX',workload:'application'};
   if(event.httpMethod==='GET'){
    const saved=await database().getWithMetadata(usageKey(user),{type:'json'});
    if(saved&&!validProfile(saved.data?.sealedProfile))fail('encrypted_profile_invalid',503);
    return jsonResponse(200,{ok:true,policy,controllerUrl:CONTROLLER,sealedProfile:saved?.data?.sealedProfile||null,profileRevision:saved?.etag||null});
   }
   if(Buffer.byteLength(event.body||'')>160000)fail('body_too_large',413);
   let body;try{body=JSON.parse(event.body);}catch{fail('invalid_json');}
   if(!body||typeof body!=='object'||Array.isArray(body))fail('invalid_request');
   if(event.httpMethod==='PUT'){
    if(Object.keys(body).some(k=>!['sealedProfile','profileRevision'].includes(k))||!validProfile(body.sealedProfile)
      ||!(body.profileRevision===null||typeof body.profileRevision==='string'&&body.profileRevision.length<=200))fail('invalid_encrypted_profile');
    const db=database(),key=usageKey(user);
    const written=await db.setJSON(key,{version:1,sealedProfile:body.sealedProfile,savedAt:new Date(clock()).toISOString()},body.profileRevision===null?{onlyIfNew:true}:{onlyIfMatch:body.profileRevision});
    if(!written.modified)fail('profile_changed_reload_required',409);
    const saved=await db.getWithMetadata(key,{type:'json'});
    if(saved?.data?.sealedProfile!==body.sealedProfile)fail('profile_changed_reload_required',409);
    return jsonResponse(200,{ok:true,profileRevision:saved.etag});
   }
   if(!['bridge','complete-bridge'].includes(body.action)||!['supabase','dropbox'].includes(body.provider)
     ||body.provider==='supabase'&&!['source','target'].includes(body.slot)
     ||body.provider==='dropbox'&&body.slot!==undefined&&body.slot!=='vault')fail('invalid_bridge_request');
   const allowed=body.action==='bridge'?['action','provider','slot','offer','challenge','responseKey']:['action','provider','slot','bridgeId'];
   if(Object.keys(body).some(k=>!allowed.includes(k)))fail('invalid_bridge_request');
   await initialize();const signingSecret=secret();if(signingSecret.length<16)fail('oauth_configuration_unavailable',503);
   const name=cookieName(body.provider,body.slot),raw=cookie(event,name);
   if(!raw)fail('provider_connection_required',409);
   const bridgeId=value=>createHmac('sha256',signingSecret).update(JSON.stringify([user.id,body.provider,body.slot||'vault',value])).digest('base64url');
   if(body.action==='complete-bridge'){
    const expected=bridgeId(raw);
    if(!NONCE.test(body.bridgeId||'')||!timingSafeEqual(Buffer.from(body.bridgeId),Buffer.from(expected)))fail('provider_grant_changed',409);
    const cookies=[serialize(name,null,0)];
    if(body.provider==='supabase'&&body.slot==='source')cookies.push(serialize('pb_oauth_sb_token',null,0));
    return {...jsonResponse(200,{ok:true,delegated:true}),multiValueHeaders:{'Set-Cookie':cookies}};
   }
   if(!NONCE.test(body.challenge||'')||!NONCE.test(body.responseKey||''))fail('invalid_bridge_request');
   let verified;try{verified=await verify(body.offer,body.challenge,policy);}catch{fail('attestation_rejected',403);}
   let session=body.provider==='supabase'?openSupabaseSession(raw,signingSecret):raw;
   if(!session||typeof session.accessToken!=='string'||typeof session.refreshToken!=='string'||!session.refreshToken
      ||session.accessToken.length>16000||session.refreshToken.length>16000)fail('renewable_provider_connection_required',409);
   let exported=raw,renewal;
   if(body.provider==='supabase'&&session.expiresAt<=clock()+60000){
    try{session=await refresh({refreshToken:session.refreshToken});}catch{fail('provider_reauthorization_required',409);}
    exported=sealSupabaseSession(session,signingSecret);renewal=serialize(name,exported,7*86400);
   }
   if(body.provider==='dropbox'&&(!Number.isFinite(session.expiresAt)||session.expiresAt<=clock()+60000)){
    try{session=await refreshDropbox({refreshToken:session.refreshToken,clientId:raw.clientId||undefined});}catch{fail('provider_reauthorization_required',409);}
    exported={...raw,...session};renewal=serialize(name,exported,86400);
   }
   if(!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=clock()||session.expiresAt>clock()+86400000)fail('invalid_provider_expiry',409);
   const operation=body.provider==='supabase'?'oauth.import':'vault.import';
   const grant={accessToken:session.accessToken,refreshToken:session.refreshToken,expiresAt:Number.isFinite(session.expiresAt)?session.expiresAt:clock()};
   const input=body.provider==='supabase'?{slot:body.slot,session:grant}:{provider:'dropbox',session:grant};
   const plaintext=Buffer.from(JSON.stringify({sessionId:body.offer.sessionId,challenge:body.challenge,responseKey:body.responseKey,operation,input}));
   let envelope;try{envelope=await new CompactEncrypt(plaintext).setProtectedHeader({alg:'RSA-OAEP-256',enc:'A256GCM',typ:TYPE}).encrypt(verified.encryptionKey);}finally{plaintext.fill(0);}
   return {...jsonResponse(200,{ok:true,envelope,bridgeId:bridgeId(exported)}),...(renewal?{multiValueHeaders:{'Set-Cookie':[renewal]}}:{})};
  }catch(error){return jsonResponse(error.status||503,{error:error.code||'confidential_session_unavailable'});}
 };
}
const sessionHandler=createConfidentialSessionHandler();
export default async function handler(request){
 const result=await sessionHandler({httpMethod:request.method,headers:Object.fromEntries(request.headers),body:request.method==='GET'?'':await request.text()});
 const headers=new Headers(result.headers);for(const cookie of result.multiValueHeaders?.['Set-Cookie']||[])headers.append('Set-Cookie',cookie);
 return new Response(result.body,{status:result.statusCode,headers});
}
