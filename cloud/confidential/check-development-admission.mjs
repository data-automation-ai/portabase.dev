// Admission reservations only: never starts a runner, capture, or restore.
import {randomUUID} from 'node:crypto';
import {operatorGoogle} from './operator-google.mjs';
const endpoint=process.argv[2];
if(!/^https:\/\/[a-f0-9]{24}--portabase-dev\.netlify\.app\/\.netlify\/functions\/cloud-confidential-admission$/.test(endpoint||''))throw new Error('invalid_validation_endpoint');
const google=await operatorGoogle();
const raw=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-validation/versions/latest:access');
const fixture=JSON.parse(Buffer.from(raw.payload.data,'base64'));
if(fixture.projectRef!=='eoiqvdmvgaurlecdzqkp'||fixture.id!=='6f454f7b-b490-4fe9-9c49-48ce5b6f4408')throw new Error('identity_mismatch');
const login=await fetch(`https://${fixture.projectRef}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:'sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL','content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password}),signal:AbortSignal.timeout(20000)});
if(!login.ok)throw new Error('login_failed');
const session=await login.json();if(session.user.id!==fixture.id)throw new Error('identity_mismatch');
const requestId=randomUUID();
const call=(id,authenticated=true)=>fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(authenticated?{authorization:`Bearer ${session.access_token}`}:{})},body:JSON.stringify({operation:'backup.start',requestId:id}),signal:AbortSignal.timeout(20000)});
const first=await call(requestId),second=await call(randomUUID()),replay=await call(requestId),anonymous=await call(randomUUID(),false);
const proof={first:first.status,second:second.status,replay:replay.status,anonymous:anonymous.status,jobsStarted:0};
console.log(JSON.stringify(proof));
if(first.status!==200||second.status!==200||replay.status!==409||anonymous.status!==401)process.exitCode=1;
