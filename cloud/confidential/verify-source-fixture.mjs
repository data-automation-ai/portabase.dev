import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {operatorConfig} from './operator-config.mjs';
import {operatorGoogle} from './operator-google.mjs';
async function main(){
 const evidence=JSON.parse(await readFile(new URL('./evidence/seeded-source-fixture.json',import.meta.url),'utf8'));
 const ref=evidence.source;if(ref!=='uloqvqdkeiwvnnnfdvrc')throw new Error('wrong_fixture');
 const op=await operatorConfig(),projects=await op.supabase('/projects');
 if(!projects.some(p=>p.id===ref&&p.name==='portabase-confidential-source'))throw new Error('wrong_fixture');
 const keys=await op.supabase(`/projects/${ref}/api-keys?reveal=true`);
 const anon=keys.find(k=>k.name==='anon').api_key,service=keys.find(k=>k.name==='service_role').api_key;
 const google=await operatorGoogle(),stored=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-validation/versions/latest:access');
 const fixture=JSON.parse(Buffer.from(stored.payload.data,'base64').toString());
 const password=createHash('sha256').update('isolated-source-user:'+fixture.password).digest('hex');
 const login=await fetch(`https://${ref}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:anon,'content-type':'application/json'},
  body:JSON.stringify({email:'portabase-recovery-drill@example.com',password}),signal:AbortSignal.timeout(15000)});
 if(!login.ok)throw new Error('source_test_login_failed');const session=await login.json();
 const query='/rest/v1/portabase_drill_items?select=id,label,amount&order=id';
 const fetchSource=(path,token)=>fetch(`https://${ref}.supabase.co`+path,{headers:{apikey:anon,Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});
 const own=await fetchSource(query,session.access_token),anonymous=await fetchSource(query,anon);
 if(!own.ok)throw new Error('authenticated_rows_failed');const rows=await own.json();
 const hidden=anonymous.ok?(await anonymous.json()).length===0:[401,403].includes(anonymous.status);
 const object=await fetchSource(`/storage/v1/object/${evidence.storage.bucket}/${evidence.storage.object}`,service);
 if(!object.ok)throw new Error('source_object_read_failed');const bytes=Buffer.from(await object.arrayBuffer());
 const func=await fetchSource('/functions/v1/portabase-drill-proof',service);
 const functionVerified=func.ok&&(await func.json()).fixture==='portabase-confidential-dry-run';
 const record={checkedAt:new Date().toISOString(),source:ref,passwordLoginVerified:true,authenticatedRows:rows.length,
  anonymousReadDenied:hidden,rowFingerprint:createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
  objectBytesVerified:createHash('sha256').update(bytes).digest('hex')===evidence.storage.sha256,functionInvocationVerified:functionVerified};
 record.passed=rows.length===3&&hidden&&record.objectBytesVerified&&functionVerified;
 await writeFile(new URL('./evidence/source-baseline-live.json',import.meta.url),JSON.stringify(record,null,2)+'\n');
 console.log(JSON.stringify(record,null,2));if(!record.passed)process.exitCode=1;
}
main().catch(e=>{console.error(/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'source_validation_failed');process.exitCode=1;});
