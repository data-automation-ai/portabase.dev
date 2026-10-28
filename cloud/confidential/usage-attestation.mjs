import { request } from 'node:http';
import { createRemoteJWKSet,jwtVerify } from 'jose';
import { ISSUER,GOOGLE_JWKS,APPLICATION_ENTRYPOINT,validatePolicy } from './attestation.mjs';
export const USAGE_AUDIENCE='urn:portabase:usage:v1';
const PURPOSE='portabase-usage-meter-v1';
const googleKeys=createRemoteJWKSet(new URL(GOOGLE_JWKS),{timeoutDuration:5000});
export function requestUsageAttestation(challenge) {
  return new Promise((resolve,reject)=>{
    const body=JSON.stringify({audience:USAGE_AUDIENCE,token_type:'OIDC',nonces:[challenge,PURPOSE]});
    const req=request({socketPath:'/run/container_launcher/teeserver.sock',path:'/v1/token',method:'POST',
      headers:{'content-type':'application/json','content-length':Buffer.byteLength(body)}},res=>{
      let data='';res.on('data',chunk=>{data+=chunk;if(data.length>32768)req.destroy(Error('usage_attestation_unavailable'));});
      res.on('error',()=>reject(Error('usage_attestation_unavailable')));
      res.on('end',()=>res.statusCode===200&&/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.trim())
        ?resolve(data.trim()):reject(Error('usage_attestation_unavailable')));
    });
    req.setTimeout(5000,()=>req.destroy(Error('usage_attestation_unavailable')));req.on('error',()=>reject(Error('usage_attestation_unavailable')));req.end(body);
  });
}
/** Generic /attest tokens use a DIFFERENT fixed audience and cannot sign usage. */
export async function verifyUsageAttestation(offer,challenge,policy,{keyResolver=googleKeys,now=new Date()}={}) {
  validatePolicy(policy);
  if(!/^[A-Za-z0-9_-]{43}$/.test(challenge)||typeof offer?.attestation!=='string'||offer.attestation.length>32768)throw Error('invalid_usage_attestation');
  const {payload:p}=await jwtVerify(offer.attestation,keyResolver,{algorithms:['RS256'],issuer:ISSUER,audience:USAGE_AUDIENCE,
    requiredClaims:['exp','iat','nbf','sub'],maxTokenAge:'120s',clockTolerance:5,currentDate:now});
  const container=p.submods?.container,support=p.submods?.confidential_space?.support_attributes;
  if(p.swname!=='CONFIDENTIAL_SPACE'||p.secboot!==true||p.dbgstat!=='disabled-since-boot'||p.hwmodel!==policy.hardware
    ||p.submods?.gce?.project_number!==policy.projectNumber||!Array.isArray(support)||!support.includes('STABLE')||!support.includes('USABLE')
    ||container?.image_digest!==policy.imageDigest||JSON.stringify(container.args)!==JSON.stringify(APPLICATION_ENTRYPOINT)
    ||container.restart_policy!=='Never'||(container.cmd_override!==undefined&&(!Array.isArray(container.cmd_override)||container.cmd_override.length))
    ||(container.env_override!==undefined&&(!container.env_override||Array.isArray(container.env_override)||Object.keys(container.env_override).length))
    ||JSON.stringify(p.eat_nonce)!==JSON.stringify([challenge,PURPOSE]))throw Error('invalid_usage_attestation');
  return true;
}
