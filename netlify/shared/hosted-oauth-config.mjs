// Private, encrypted deployment configuration. Reuses the site's existing
// Blobs credentials so unrelated published functions keep their environment.
import {getStore} from '@netlify/blobs';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
const key=token=>createHash('sha256').update('portabase-hosted-oauth-v1:').update(token).digest();
export function sealOAuthConfig(config,token){
  if(!token)throw Error('private_configuration_key_required');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(token),iv);
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(config),'utf8'),cipher.final()]);
  return {version:1,data:Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url')};
}
export function openOAuthConfig(envelope,token){
  if(envelope?.version!==1||!token)throw Error('private_configuration_unavailable');
  const bytes=Buffer.from(envelope.data,'base64url'),decipher=createDecipheriv('aes-256-gcm',key(token),bytes.subarray(0,12));
  decipher.setAuthTag(bytes.subarray(12,28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8'));
}
let loading;
export async function initializeHostedOAuth(){
  if(process.env.SUPABASE_OAUTH_CLIENT_ID&&process.env.SUPABASE_OAUTH_CLIENT_SECRET)return;
  if(!process.env.NETLIFY_BLOBS_TOKEN||!process.env.NETLIFY_BLOBS_SITE_ID)return;
  if(!loading)loading=(async()=>{
    const store=getStore({name:'portabase-hosted-oauth',siteID:process.env.NETLIFY_BLOBS_SITE_ID,token:process.env.NETLIFY_BLOBS_TOKEN,consistency:'strong'});
    const envelope=await store.get('config',{type:'json'});if(!envelope)return;
    const config=openOAuthConfig(envelope,process.env.NETLIFY_BLOBS_TOKEN);
    if(config.redirectUri!=='https://portabase.dev/confidential/callback')throw Error('oauth_configuration_identity_mismatch');
    process.env.SUPABASE_OAUTH_CLIENT_ID=config.clientId;process.env.SUPABASE_OAUTH_CLIENT_SECRET=config.clientSecret;process.env.SUPABASE_OAUTH_REDIRECT_URI=config.redirectUri;
  })().catch(error=>{loading=null;throw error;});
  await loading;
}
