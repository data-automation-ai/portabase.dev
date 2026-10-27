// Controlled synthetic source only. Never writes to the restore target.
import {createHash} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {operatorConfig} from './operator-config.mjs';
import {operatorGoogle} from './operator-google.mjs';
const SOURCE='uloqvqdkeiwvnnnfdvrc',TARGET='jmqjsyyyhhwvkbqexxog',ORG='ipxhidmxekjpzrwubhzo';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function main(){
 const op=await operatorConfig(),projects=await op.supabase('/projects');
 for(const [ref,name] of [[SOURCE,'portabase-confidential-source'],[TARGET,'portabase-confidential-target']]){
  if(!projects.some(p=>p.id===ref&&p.name===name&&p.organization_id===ORG))throw new Error('fixture_project_mismatch');
 }
 const query=async(ref,sql)=>op.supabase(`/projects/${ref}/database/query`,{method:'POST',body:JSON.stringify({query:sql})});
 const blankSql="SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public')::int AS tables,(SELECT count(*) FROM auth.users)::int AS users,(SELECT count(*) FROM storage.objects)::int AS objects";
 const target=(await query(TARGET,blankSql))[0];
 if(target.tables||target.users||target.objects)throw new Error('target_not_blank');
 const sourceTables=await query(SOURCE,"SELECT tablename FROM pg_tables WHERE schemaname='public'");
 if(sourceTables.some(t=>t.tablename!=='portabase_drill_items'))throw new Error('unexpected_source_table');
 const keys=await op.supabase(`/projects/${SOURCE}/api-keys?reveal=true`);
 const service=keys.find(k=>k.name==='service_role')?.api_key;if(!service)throw new Error('fixture_service_key_missing');
 async function api(path,{method='GET',body,headers={}}={}){
  const r=await fetch(`https://${SOURCE}.supabase.co`+path,{method,headers:{apikey:service,Authorization:`Bearer ${service}`,...headers},body,redirect:'error',signal:AbortSignal.timeout(20000)});
  return r;
 }
 const users=await api('/auth/v1/admin/users');if(!users.ok)throw new Error('fixture_users_unavailable');
 const list=(await users.json()).users||[];
 if(list.some(u=>u.user_metadata?.fixture!=='portabase-confidential-dry-run'))throw new Error('unexpected_source_user');
 let user=list[0];
 if(!user){
  const google=await operatorGoogle(),s=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-validation/versions/latest:access');
  const f=JSON.parse(Buffer.from(s.payload.data,'base64').toString());
  const password=hash('isolated-source-user:'+f.password);
  const r=await api('/auth/v1/admin/users',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'portabase-recovery-drill@example.com',password,email_confirm:true,user_metadata:{fixture:'portabase-confidential-dry-run'}})});
  if(!r.ok)throw new Error('fixture_user_create_failed');user=await r.json();
 }
 if(!/^[a-f0-9-]{36}$/i.test(user.id))throw new Error('fixture_user_invalid');
 await query(SOURCE,`BEGIN;
 CREATE TABLE IF NOT EXISTS public.portabase_drill_items(id integer PRIMARY KEY,owner_id uuid NOT NULL REFERENCES auth.users(id),label text NOT NULL,amount numeric(10,2),created_at timestamptz NOT NULL);
 ALTER TABLE public.portabase_drill_items ENABLE ROW LEVEL SECURITY;
 DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='portabase_drill_items' AND policyname='read_own_drill_items') THEN CREATE POLICY read_own_drill_items ON public.portabase_drill_items FOR SELECT TO authenticated USING(auth.uid()=owner_id); END IF; END $$;
 GRANT SELECT ON public.portabase_drill_items TO authenticated;
 INSERT INTO public.portabase_drill_items VALUES
 (1,'${user.id}','Synthetic drill row',12.34,'2026-10-24T12:00:00Z'),
 (2,'${user.id}','Unicode café — recovery',0.00,'2026-10-24T12:01:00Z'),
 (3,'${user.id}','Nullable value',NULL,'2026-10-24T12:02:00Z') ON CONFLICT(id) DO NOTHING;
 COMMIT;`);
 const bucket='portabase-drill-private',object='recovery-proof.txt';
 const b=await api('/storage/v1/bucket/'+bucket);
 if(b.status===404||b.status===400){const created=await api('/storage/v1/bucket',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:bucket,name:bucket,public:false})});if(!created.ok)throw new Error('fixture_bucket_failed');}
 else if(!b.ok||(await b.json()).public)throw new Error('fixture_bucket_invalid');
 const payload=Buffer.from('Portabase isolated recovery drill\nSynthetic object bytes — café\n');
 const existing=await api(`/storage/v1/object/${bucket}/${object}`);
 if(existing.ok){if(hash(Buffer.from(await existing.arrayBuffer()))!==hash(payload))throw new Error('fixture_object_mismatch');}
 else{const uploaded=await api(`/storage/v1/object/${bucket}/${object}`,{method:'POST',headers:{'content-type':'text/plain','x-upsert':'false'},body:payload});if(!uploaded.ok)throw new Error('fixture_object_upload_failed');}
 const functionCode='Deno.serve(() => new Response(JSON.stringify({fixture:"portabase-confidential-dry-run",ok:true}),{headers:{"content-type":"application/json"}}));\n';
 const form=new FormData();form.append('metadata',JSON.stringify({name:'portabase-drill-proof',entrypoint_path:'index.ts',verify_jwt:true}));form.append('file',new Blob([functionCode],{type:'application/typescript'}),'index.ts');
 const deployed=await fetch(`https://api.supabase.com/v1/projects/${SOURCE}/functions/deploy?slug=portabase-drill-proof`,{method:'POST',headers:{Authorization:`Bearer ${op.value('SUPABASE_MANAGEMENT_TOKEN')}`},body:form,redirect:'error',signal:AbortSignal.timeout(60000)});
 if(!deployed.ok)throw new Error(`fixture_function_http_${deployed.status}`);
 const counts=(await query(SOURCE,blankSql))[0];
 const record={checkedAt:new Date().toISOString(),source:SOURCE,target:TARGET,sourceCounts:counts,targetCounts:target,table:'portabase_drill_items',rows:3,
  storage:{bucket,object,bytes:payload.length,sha256:hash(payload)},function:{name:'portabase-drill-proof',sourceSha256:hash(functionCode)},syntheticOnly:true,targetWritten:false};
 await writeFile(new URL('./evidence/seeded-source-fixture.json',import.meta.url),JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify(record,null,2));
}
main().catch(e=>{console.error(/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'fixture_seed_failed');process.exitCode=1;});
