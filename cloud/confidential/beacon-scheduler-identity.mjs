import {createRemoteJWKSet,jwtVerify} from 'jose';
import {BEACON_SCHEDULER_ACCOUNT} from './beacon-config.mjs';
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export function schedulerIdentity({audience=process.env.BEACON_SCHEDULER_AUDIENCE,keyResolver=keys}={}) {
  return async authorization=>{
    if(!/^https:\/\/portabase-confidential-controller-[a-z0-9-]+\.a\.run\.app\/beacon\/tick$/.test(audience||'')||!/^Bearer [A-Za-z0-9_.-]+$/.test(authorization||''))throw Error('beacon_scheduler_unauthorized');
    const {payload}=await jwtVerify(authorization.slice(7),keyResolver,{issuer:['https://accounts.google.com','accounts.google.com'],audience,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email'],maxTokenAge:'70m',clockTolerance:5});
    if(payload.email!==BEACON_SCHEDULER_ACCOUNT||payload.email_verified!==true)throw Error('beacon_scheduler_unauthorized');
    return true;
  };
}
