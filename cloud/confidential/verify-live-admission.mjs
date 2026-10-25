// Isolated fixture only: reserve, deny duplicates, then remove only this test
// reservation after proving no test VM exists. Never touch a customer counter.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {operatorGoogle} from './operator-google.mjs';
const ID='6f454f7b-b490-4fe9-9c49-48ce5b6f4408',SITE='794217cc-42ab-4a9f-81da-06a661403573';
let stage='init';
async function main(){
 const draft=JSON.parse(await readFile(new URL('./evidence/admission-isolated-native-draft.json',import.meta.url),'utf8'));
 const google=await operatorGoogle(),stored=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-validation/versions/latest:access');
 const fixture=JSON.parse(Buffer.from(stored.payload.data,'base64').toString());
 if(fixture.id!==ID||fixture.projectRef!=='eoiqvdmvgaurlecdzqkp')throw new Error('wrong_fixture');
 const config=JSON.parse(await readFile(join(process.env.APPDATA,'netlify/Config/config.json'),'utf8'));
 const database=getStore({name:'portabase-confidential-admission',siteID:SITE,token:config.users[config.userId].auth.token,consistency:'strong'});
 const key=createHash('sha256').update('supabase:'+ID).digest('hex');
 stage='read_counter';if(await database.get(key))throw new Error('test_counter_already_exists');
 const login=await fetch(`https://${fixture.projectRef}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',
  headers:{apikey:'sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL','content-type':'application/json'},
  body:JSON.stringify({email:fixture.email,password:fixture.password}),signal:AbortSignal.timeout(15000)});
 if(!login.ok)throw new Error('test_login_failed');const session=await login.json();
 const requestId=randomUUID();
 async function call(operation,id=requestId,authenticated=true){
  const response=await fetch(draft.url+'/.netlify/functions/cloud-confidential-admission',{method:'POST',
   headers:{...(authenticated?{Authorization:`Bearer ${session.access_token}`}:{ }),'content-type':'application/json','x-portabase-cloud-version':'supabase'},
   body:JSON.stringify({operation,requestId:id}),signal:AbortSignal.timeout(20000)});
  const type=response.headers.get('content-type')||'';
  const body=type.includes('application/json')?await response.json():{error:'non_json_response',contentType:type};return {status:response.status,body};
 }
 stage='invoke';const results={anonymous:await call('quota.inspect',requestId,false),quota:await call('quota.inspect'),first:await call('runner.start'),
  duplicate:await call('runner.start'),second:await call('runner.start',randomUUID())};
 const saved=await database.get(key,{type:'json'});
 const record={checkedAt:new Date().toISOString(),draft:draft.id,results,persistentReservationVerified:saved?.starts?.length===1&&saved.starts[0].id===requestId,
  passed:results.anonymous.status===401&&results.quota.body.maxBytes===10737418240&&results.first.status===200&&results.duplicate.status===409&&results.second.status===429};
 // The only stored entry was created above. No VM allocation is performed here.
 if(saved?.starts?.length===1&&saved.starts[0].id===requestId&&!saved.runs?.length){await database.delete(key);record.syntheticCounterReset=await database.get(key)===null;}
 await writeFile(new URL('./evidence/admission-live-persistence.json',import.meta.url),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify(record,null,2));if(!record.passed)process.exitCode=1;
}
main().catch(e=>{console.error(JSON.stringify({stage,errorClass:e.name,status:e.status,code:e.code,error:/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'admission_probe_failed'}));process.exitCode=1;});
