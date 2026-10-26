// Operator-only, isolated test identity. Tokens, recovery key and OAuth codes
// remain in memory; the code/token exchange occurs inside the attested VM.
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {operatorGoogle} from './operator-google.mjs';
import {confidentialClient} from './client.mjs';
import {executeDryRun} from './execute-dry-run.mjs';
import {parsePastedCallback,renderDryRunPage} from './dry-run-gui.mjs';
const CONTROLLER='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const DIGEST='sha256:47cc54f62deac587671ef6a59f778e155723883c4188df6700293bd289ea940f';
const REF='eoiqvdmvgaurlecdzqkp',ID='6f454f7b-b490-4fe9-9c49-48ce5b6f4408';
// Supabase's live authorize endpoint rejects HTTP loopback callbacks even
// when registered. The test verifier receives the HTTPS callback by handoff.
const CALLBACK='https://portabase.dev/confidential/callback';
const status={state:'starting',connections:{source:false,target:false,dropbox:false},accounts:{},allocation:'customer-authenticated admission',
 selection:{},backupExecuted:false,restoreExecuted:false};
const pending=new Map(),links={},offers={},projects={source:[],target:[]},runNonce=randomUUID();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 const google=await operatorGoogle();
 const raw=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-validation/versions/latest:access');
 const fixture=JSON.parse(Buffer.from(raw.payload.data,'base64').toString());
 if(fixture.projectRef!==REF||fixture.id!==ID)throw new Error('fixture_identity_mismatch');
 let session;
 async function authorization(){
  if(!session||session.expires_at<Date.now()/1000+120){
   const r=await fetch(`https://${REF}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',
    headers:{apikey:'sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL','content-type':'application/json'},
    body:JSON.stringify({email:fixture.email,password:fixture.password}),signal:AbortSignal.timeout(20000),redirect:'error'});
   if(!r.ok)throw new Error('fixture_login_failed');session=await r.json();
   if(session.user?.id!==ID||!session.access_token)throw new Error('fixture_identity_mismatch');
  }
  return `Bearer ${session.access_token}`;
 }
 const policy={hardware:'GCP_INTEL_TDX',projectNumber:'495102144848',imageDigest:DIGEST,workload:'application'};
 const client=confidentialClient({url:CONTROLLER,policy,getAuthorization:authorization});
 const profileSecret='/v1/projects/portabase-dev/secrets/portabase-confidential-validation-profile';
 const storedProfile=await google(profileSecret+'/versions/latest:access');
 let sealedProfile=storedProfile?JSON.parse(Buffer.from(storedProfile.payload.data,'base64').toString()).sealedProfile:undefined;
 let lastProfileSave=0;
 async function command(operation,input={}){
  const result=await client.command(operation,input);
  if(result.sealedProfile){sealedProfile=result.sealedProfile;delete result.sealedProfile;}
  if(sealedProfile&&(['oauth.finish','vault.finish'].includes(operation)||Date.now()-lastProfileSave>30000)){
   if(!await google(profileSecret))await google('/v1/projects/portabase-dev/secrets?secretId=portabase-confidential-validation-profile',{method:'POST',body:{replication:{automatic:{}}}});
   await google(profileSecret+':addVersion',{method:'POST',body:{payload:{data:Buffer.from(JSON.stringify({sealedProfile})).toString('base64')}}});lastProfileSave=Date.now();
  }
  return result;
 }
 const requestId=randomUUID(),deadline=Date.now()+8*60000;
 let ready;
 do{ready=await client.session(requestId);if(ready.state==='ready')break;
  if(Date.now()>deadline)throw new Error('runner_start_timeout');await sleep(6000);
 }while(true);
 // Reproducible key only for this synthetic fixture; never a customer-key policy.
 const recoveryKey=createHash('sha256').update('portabase-isolated-validation:'+fixture.password).digest('base64url');
 const opened=await command('session.open',{recoveryKey,...(sealedProfile?{sealedProfile}:{})});
 await command('key.acknowledge');
 Object.assign(status,{state:'awaiting_oauth',attestation:client.evidence(),connections:opened.connected,
   selection:opened.selection||{}});
 async function beginDropbox(){
  if(status.connections.dropbox)return;
  const offer=await command('vault.begin');links.dropbox=offer.url;offers.dropbox=Date.now();
 }
 async function begin(slot){
  for(const [state,oldSlot] of pending)if(oldSlot===slot)pending.delete(state);
  const offer=await command('oauth.begin',{slot,redirectUri:CALLBACK});
  pending.set(offer.state,slot);links[slot]=offer.url;offers[slot]=Date.now();
 }
 async function refreshProjects(slot){
  const result=await command('projects.list',{slot});
  projects[slot]=result.projects;
  if(status.selection[slot]&&!projects[slot].some(p=>p.ref===status.selection[slot]))delete status.selection[slot];
 }
 async function refreshIdentity(slot){
  if(!status.connections[slot]){delete status.accounts[slot];return;}
  const result=await command('oauth.identity',{slot});status.accounts[slot]=result.identity;
 }
 async function refreshSourceInventory(){
  const ref=status.selection.source;
  if(!status.connections.source||!ref){status.inventory=null;status.scope=null;return null;}
  if(status.inventory?.ref===ref)return status.inventory;
  const result=await command('source.inventory');
  status.inventory=result.inventory;
  status.scope={tables:result.inventory.tables.map(row=>row.name),buckets:result.inventory.buckets.map(row=>row.id),auth:true,functions:true};
  return status.inventory;
 }
 async function preflight(){
  delete status.preflight;delete status.error;
  if(status.connections.source&&status.connections.target&&(!status.accounts.source||!status.accounts.target)){
   for(const slot of ['source','target'])await refreshIdentity(slot);
  }
  if(status.accounts.source&&status.accounts.target&&
    (status.accounts.source.id===status.accounts.target.id||status.accounts.source.email===status.accounts.target.email)){
   status.state='account_mismatch_required';status.error='destination_account_must_differ';await persist();return;
  }
  if(status.connections.source&&status.selection.source)await refreshSourceInventory();
  if(!status.connections.source||!status.connections.target||!status.connections.dropbox||!status.selection.source||!status.selection.target){
   status.state='select_projects';await persist();return;
  }
  for(const slot of ['source','target']){
   if(!projects[slot].some(p=>p.ref===status.selection[slot]))throw new Error('project_not_authorized');
   await command('project.select',{slot,ref:status.selection[slot]});
  }
  const result=await command('preflight');
  status.preflight={ready:result.ready,source:result.source,target:result.target,dataFlow:result.dataFlow};
  status.state=result.ready?'preflight_passed':'preflight_blocked';
  await persist();
 }
 async function finishCallback({state,code}){
  const slot=pending.get(state);if(!slot)throw new Error('oauth_state_mismatch');
  try{await command('oauth.finish',{slot,state,code});}
  catch(error){pending.delete(state);await begin(slot);throw error;}
  pending.delete(state);
  status.connections[slot]=true;delete links[slot];delete offers[slot];
  await refreshIdentity(slot);
  await refreshProjects(slot);await preflight();await persist();
 }
 async function persist(){await writeFile(new URL('./evidence/customer-session-live.json',import.meta.url),JSON.stringify({...status,checkedAt:new Date().toISOString()},null,2)+'\n');}
 for(const slot of ['source','target'])if(!status.connections[slot])await begin(slot);
 if(!status.connections.dropbox)await beginDropbox();
 for(const slot of ['source','target'])if(status.connections[slot]){await refreshIdentity(slot);await refreshProjects(slot);}
 await preflight();await persist();
 const server=createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:58441'){res.writeHead(400);return res.end();}
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const url=new URL(req.url,'http://127.0.0.1:58441');
  try{
   if(req.method==='POST'&&['/callback','/dropbox','/select','/scope','/execute','/reauthorize'].includes(url.pathname)){
    if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:58441'){res.writeHead(403);return res.end();}
    if(!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')){res.writeHead(415);return res.end();}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024*1024)throw new Error('request_too_large');}
    const form=new URLSearchParams(raw);
    if(form.get('nonce')!==runNonce)throw new Error('test_confirmation_required');
    if(url.pathname==='/callback'){
     await finishCallback(parsePastedCallback(form.get('callbackUrl')));
     res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/reauthorize'){
     if(status.executing)throw new Error('drill_already_running');
     const slot=form.get('slot');if(!['source','target'].includes(slot))throw new Error('invalid_connection_slot');
     await begin(slot);res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/dropbox'){
     if(status.connections.dropbox)throw new Error('dropbox_already_connected');
     await command('vault.finish',{code:form.get('code')});
     status.connections.dropbox=true;delete links.dropbox;delete offers.dropbox;
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/select'){
     if(status.executing)throw new Error('drill_already_running');
     const slot=form.get('slot'),ref=form.get('ref');
     if(!['source','target'].includes(slot)||!status.connections[slot]||!projects[slot].some(p=>p.ref===ref))throw new Error('project_not_authorized');
     await command('project.select',{slot,ref});
     if(status.selection[slot]!==ref){delete status.preflight;if(slot==='source'){status.inventory=null;status.scope=null;}}
     status.selection[slot]=ref;
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/scope'){
     if(status.executing||!status.inventory||status.inventory.ref!==status.selection.source)throw new Error('source_inventory_required');
     const indices=(key,max)=>form.getAll(key).map(value=>{
      if(!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('invalid_source_scope');
      const index=Number(value);if(!Number.isSafeInteger(index)||index<0||index>=max)throw new Error('invalid_source_scope');return index;
     });
     const tableIndices=indices('tableIndex',status.inventory.tables.length);
     const bucketIndices=indices('bucketIndex',status.inventory.buckets.length);
     const tables=[...new Set(tableIndices)].map(index=>status.inventory.tables[index].name);
     const buckets=[...new Set(bucketIndices)].map(index=>status.inventory.buckets[index].id);
     if(tables.length!==status.inventory.tables.length&&status.inventory.tables.some(row=>!row.selectable))throw new Error('selective_table_names_unsupported');
     if(buckets.length!==status.inventory.buckets.length&&buckets.some(id=>!status.inventory.buckets.find(row=>row.id===id)?.selectable))throw new Error('selective_bucket_names_unsupported');
     status.scope={tables,buckets,auth:form.get('auth')==='yes',functions:form.get('functions')==='yes'};
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(form.get('confirmSource')!==status.selection.source||form.get('confirmTarget')!==status.selection.target
      ||form.get('acknowledgeBlankTarget')!=='yes'||form.get('acknowledgeScope')!=='yes')throw new Error('test_confirmation_required');
    if(status.state!=='preflight_passed'||status.preflight?.target?.blank!==true)throw new Error('preflight_required');
    if(status.executing)throw new Error('drill_already_running');
    if(!status.connections.dropbox)throw new Error('dropbox_connection_required');
    if(!status.inventory||!status.scope)throw new Error('source_scope_required');
    executeDryRun({command,status,persist,sourceRef:status.selection.source,targetRef:status.selection.target,vault:'dropbox',scope:status.scope}).catch(()=>{});
    res.writeHead(303,{location:'/'});return res.end();
   }
   if(req.method!=='GET'){res.writeHead(405);return res.end();}
   if(url.pathname==='/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(status));}
   if(url.pathname==='/confidential/callback'){
    if(url.searchParams.has('error'))throw new Error('oauth_authorization_denied');
    await finishCallback({state:url.searchParams.get('state'),code:url.searchParams.get('code')});
    res.writeHead(303,{location:'/'});return res.end();
   }
   if(url.pathname!=='/'){res.writeHead(404);return res.end();}
   // Fresh offers when a reviewer resumes after consent expiry.
   for(const slot of ['source','target'])if(!status.connections[slot]&&(!links[slot]||Date.now()-offers[slot]>8*60000))await begin(slot);
   if(!status.connections.dropbox&&(!links.dropbox||Date.now()-offers.dropbox>8*60000))await beginDropbox();
   res.setHeader('content-type','text/html; charset=utf-8');
   res.end(renderDryRunPage({status,projects,selection:status.selection,links,nonce:runNonce}));
  }catch(e){status.error=/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:'validation_request_failed';await persist();
   res.writeHead(400,{'content-type':'text/plain'});res.end(status.error);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(58441,'127.0.0.1',resolve);});
 console.log(JSON.stringify({state:status.state,url:'http://127.0.0.1:58441',attestation:status.attestation}));
 setTimeout(()=>server.close(),230*60000).unref();
}
main().catch(e=>{console.error(/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:'customer_session_failed');process.exitCode=1;});
