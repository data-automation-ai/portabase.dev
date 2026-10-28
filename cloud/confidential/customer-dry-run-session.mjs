// Operator-only, isolated test identity. Tokens, recovery key and OAuth codes
// remain in memory; the code/token exchange occurs inside the attested VM.
import {createServer} from 'node:http';
import {validateProjectMapping} from './project-mapping.mjs';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {operatorGoogle} from './operator-google.mjs';
import {confidentialClient} from './client.mjs';
import {executeDryRun} from './execute-dry-run.mjs';
import {parsePastedCallback,renderDryRunPage} from './dry-run-gui.mjs';
import {renderAttestationCertificate} from './attestation-certificate.mjs';
import {needsOAuthOffer} from './oauth-offer.mjs';
import {handleVaultAction} from './helper-vault-actions.mjs';
const CONTROLLER='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const DIGEST='sha256:e07a22d267f8aecb0c5896f1abf9eb38faca8d962fe45425dcc1d4491e3ad55a';
const REF='eoiqvdmvgaurlecdzqkp',ID='6f454f7b-b490-4fe9-9c49-48ce5b6f4408';
// Supabase's live authorize endpoint rejects HTTP loopback callbacks even
// when registered. The test verifier receives the HTTPS callback by handoff.
const CALLBACK='https://portabase.dev/confidential/callback';
const DROPBOX_CALLBACK='http://localhost:58441/oauth/dropbox/callback';
const operatingMode=process.env.PORTABASE_OPERATING_MODE||'development';
if(!['development','production'].includes(operatingMode))throw new Error('invalid_operating_mode');
const status={state:'starting',connections:{source:false,target:false,dropbox:false,s3:false},accounts:{},allocation:'customer-authenticated admission',
 operatingMode,
 activeVault:'dropbox',s3Summary:null,
 selection:{},backupExecuted:false,restoreExecuted:false,mode:'temporary_runner',capsules:[]};
async function refreshCapsules(command){
 if(!status.connections.dropbox)return;
 try{
  const res=await command('vault.capsules');
  if(Array.isArray(res?.capsules))status.capsules=res.capsules.map(c=>typeof c==='string'?c:c.id||c.name);
 }catch{
  status.capsules=status.capsules||[];
 }
}
const pending=new Map(),links={},offers={},projects={source:[],target:[]},runNonce=randomUUID();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
 let previousScope=null;
 try{const previous=JSON.parse(await readFile(new URL('./evidence/customer-session-live.json',import.meta.url),'utf8'));previousScope={source:previous.selection?.source,scope:previous.scope};if(previous.backup?.id&&(previous.backup?.state==='running'||(previous.backup?.state==='complete'&&previous.backup?.result?.captureComplete)))status.backup=previous.backup;}catch{}
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
 let openingSession=null;
 async function ensureRunnerSession(forceNew=false){
  if(openingSession&&!forceNew)return openingSession;
  const doOpen=async()=>{
   const requestId=randomUUID(),deadline=Date.now()+8*60000;
   let ready;
   do{ready=await client.session(requestId);if(ready.state==='ready')break;
    if(Date.now()>deadline)throw new Error('runner_start_timeout');await sleep(6000);
   }while(true);
   // Reproducible key only for this synthetic fixture; never a customer-key policy.
   const recoveryKey=createHash('sha256').update('portabase-isolated-validation:'+fixture.password).digest('base64url');
   const opened=await client.command('session.open',{recoveryKey,...(sealedProfile?{sealedProfile}:{})});
   if(opened.sealedProfile){sealedProfile=opened.sealedProfile;delete opened.sealedProfile;}
   await client.command('key.acknowledge');
   status.attestation=client.evidence();
   status.connections=opened.connected;
   status.activeVault=opened.connected?.activeVault||status.activeVault;
   status.s3Summary=opened.s3Summary||null;
   status.selection=opened.selection||status.selection||{};
   status.accountConfirmation=opened.accountConfirmation||status.accountConfirmation;
   if(status.state==='starting')status.state='awaiting_oauth';
   return opened;
  };
  openingSession=doOpen().finally(()=>{openingSession=null;});
  return openingSession;
 }
 async function command(operation,input={}){
  let result;
  try{
   result=await client.command(operation,input);
  }catch(err){
   if(['encrypted_request_rejected','confidential_request_failed','attestation_unavailable','runner_busy'].includes(err.message)){await sleep(2500);result=await client.command(operation,input);}else if(['runner_not_ready','session_open_required','confidential_service_unavailable'].includes(err.message)){
    await ensureRunnerSession(true);
    result=await client.command(operation,input);
   }else throw err;
  }
  if(result.sealedProfile){sealedProfile=result.sealedProfile;delete result.sealedProfile;}
  if(sealedProfile&&(['oauth.finish','oauth.token','vault.finish','vault.select','vault.s3.connect','project.select','oauth.account.confirm'].includes(operation)||Date.now()-lastProfileSave>30000)){
   if(!await google(profileSecret))await google('/v1/projects/portabase-dev/secrets?secretId=portabase-confidential-validation-profile',{method:'POST',body:{replication:{automatic:{}}}});
   await google(profileSecret+':addVersion',{method:'POST',body:{payload:{data:Buffer.from(JSON.stringify({sealedProfile})).toString('base64')}}});lastProfileSave=Date.now();
  }
  return result;
 }
 await ensureRunnerSession();
 async function beginDropbox(){
  if(status.connections.dropbox)return;
  const offer=await command('vault.begin',{redirectUri:DROPBOX_CALLBACK});links.dropbox=offer.url;offers.dropbox=Date.now();
 }
 async function begin(slot){
  for(const [state,oldSlot] of pending)if(oldSlot===slot)pending.delete(state);
  // A failed renewal must not leave a link whose state was just invalidated.
  delete links[slot];delete offers[slot];
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
  for(const row of result.inventory?.tables||[]){
   row.selectable=/^[A-Za-z_][A-Za-z0-9_$]*\.[A-Za-z0-9_$]+$/.test(row.name);
  }
  status.inventory=result.inventory;
  status.scope={tables:result.inventory.tables.map(row=>row.name),excludedTables:[],buckets:result.inventory.buckets.map(row=>row.id),auth:true,functions:true};
  if(previousScope?.source===ref&&previousScope.scope){
   const prior=previousScope.scope;
   if(Array.isArray(prior.tables)&&Array.isArray(prior.buckets)){
    status.scope={tables:prior.tables.filter(name=>result.inventory.tables.some(row=>row.name===name)),
     excludedTables:(prior.excludedTables||[]).filter(name=>result.inventory.tables.some(row=>row.name===name)),
     buckets:prior.buckets.filter(id=>result.inventory.buckets.some(row=>row.id===id)),auth:prior.auth!==false,functions:prior.functions!==false};
   }
  }
  previousScope=null;
  return status.inventory;
 }
 async function preflight(){
  delete status.preflight;delete status.error;
  if(status.connections.source&&status.connections.target&&(!status.accounts.source||!status.accounts.target)){
   for(const slot of ['source','target'])await refreshIdentity(slot);
  }
  if(status.accounts.source?.verified&&status.accounts.target?.verified&&
    (status.accounts.source.id===status.accounts.target.id||status.accounts.source.email===status.accounts.target.email)){
   status.state='account_mismatch_required';status.error='destination_account_must_differ';await persist();return;
  }
  if(status.connections.source&&status.selection.source)await refreshSourceInventory();
  if(status.connections.source&&status.connections.target&&!status.accountConfirmation&&
    !(status.accounts.source?.verified&&status.accounts.target?.verified)){
   status.state='account_confirmation_required';await persist();return;
  }
  const isCapsuleOnly=status.mode==='capsule_only';
  const isRestoreOnly=status.mode==='restore_only';
  if(!isRestoreOnly&&(!status.connections.source||!status.selection.source)){
   status.state='select_projects';await persist();return;
  }
  if(!isCapsuleOnly&&(!status.connections.target||!status.selection.target)){
   status.state='select_projects';await persist();return;
  }
  for(const slot of ['source','target']){
   if(status.selection[slot]&&!projects[slot].some(p=>p.ref===status.selection[slot]))throw new Error('project_not_authorized');
  }
  await refreshCapsules(command);
  const result=await command('preflight',{mode:status.mode,allowOverwrite:Boolean(status.allowOverwrite)});
  let ready=false;
  if(isCapsuleOnly){
   ready=Boolean(result.ready||result.source);
  }else if(isRestoreOnly){
   ready=Boolean(result.ready||(result.target&&result.target.ref!==REF));
  }else{
   ready=Boolean(result.ready||(result.source&&result.target&&result.source.ref!==result.target.ref&&result.target.ref!==REF));
  }
  status.preflight={ready,source:result.source,target:result.target,dataFlow:result.dataFlow};
  status.state=ready?'preflight_passed':'preflight_blocked';
  await persist();
 }
 async function finishCallback({state,code}){
  const slot=pending.get(state);if(!slot)throw new Error('oauth_state_mismatch');
  try{await command('oauth.finish',{slot,state,code});}
  catch(error){pending.delete(state);await begin(slot);throw error;}
  pending.delete(state);
  status.connections[slot]=true;delete links[slot];delete offers[slot];
  status.accountConfirmation=null;
  await refreshIdentity(slot);
  await refreshProjects(slot);await preflight();await persist();
 }
 async function persist(){await writeFile(new URL('./evidence/customer-session-live.json',import.meta.url),JSON.stringify({...status,checkedAt:new Date().toISOString()},null,2)+'\n');}
 const server=createServer(async(req,res)=>{
  if(!['127.0.0.1:58441','localhost:58441'].includes(req.headers.host)){res.writeHead(400);return res.end();}
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-security-policy',"default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const url=new URL(req.url,'http://127.0.0.1:58441');
  try{
   if(req.method==='POST'&&['/callback','/dropbox','/s3','/vault-provider','/select','/select-batch','/scope','/execute','/reauthorize','/confirm-accounts','/mode','/supabase-token'].includes(url.pathname)){
    // Some desktop browser bridges submit local forms with an opaque Origin.
    // Every POST still requires the session nonce below, which another origin
    // cannot read through the loopback page's same-origin boundary.
    if(req.headers.origin&&!['http://127.0.0.1:58441','http://localhost:58441','null'].includes(req.headers.origin)){res.writeHead(403);return res.end();}
    if(!req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')){res.writeHead(415);return res.end();}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024*1024)throw new Error('request_too_large');}
    const form=new URLSearchParams(raw);
    if(form.get('nonce')!==runNonce)throw new Error('test_confirmation_required');
    if(await handleVaultAction({pathname:url.pathname,form,status,command,beginDropbox,persist})){
     res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/callback'){
     await finishCallback(parsePastedCallback(form.get('callbackUrl')));
     res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/reauthorize'){
     if(status.executing)throw new Error('drill_already_running');
     const slot=form.get('slot');if(slot==='dropbox'){await beginDropbox();res.writeHead(303,{location:'/'});return res.end();}
     if(!['source','target'].includes(slot))throw new Error('invalid_connection_slot');
     await begin(slot);res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/supabase-token'){
     if(status.executing)throw new Error('drill_already_running');
     const slot=form.get('slot');
     const token=form.get('token');
     if(!['source','target'].includes(slot))throw new Error('invalid_connection_slot');
     if(!token)throw new Error('invalid_access_token');
     await command('oauth.token',{slot,token});
     status.connections[slot]=true;delete links[slot];delete offers[slot];
     status.accountConfirmation=null;
     await refreshIdentity(slot);
     await refreshProjects(slot);
     await preflight();
     await persist();
     res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/confirm-accounts'){
     if(status.executing||!status.connections.source||!status.connections.target)throw new Error('supabase_connection_required');
     if(form.get('acknowledge')!=='yes')throw new Error('account_confirmation_required');
     status.accountConfirmation=await command('oauth.account.confirm',{
       sourceEmail:form.get('sourceEmail'),targetEmail:form.get('targetEmail')});
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/dropbox'){
     if(status.connections.dropbox)throw new Error('dropbox_already_connected');
     await command('vault.finish',{code:form.get('code')});
     status.connections.dropbox=true;delete links.dropbox;delete offers.dropbox;
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/select-batch'){
     if(status.executing)throw new Error('drill_already_running');
     const refs=form.getAll('sourceRefs');
     if(!refs.length||refs.some(r=>!projects.source.some(p=>p.ref===r)))throw new Error('project_not_authorized');
     const targetMap={};
     for(const r of refs){
       const t=form.get('targetFor_'+r);
       if(t)targetMap[r]=t;
     }
     validateProjectMapping({sourceRefs:refs,targetRef:targetMap[refs[0]],targetMap,mode:status.mode,authorizedTargets:projects.target.map(p=>p.ref)});
     status.selection.sources=refs;
     status.selection.source=refs[0];
     status.selection.targetMap=targetMap;
     const inspected=await command('project.select',{slot:'source',ref:refs[0]});
     status.inspections||={};status.inspections.source=inspected;
     if(status.mode!=='capsule_only'){
      status.selection.target=targetMap[refs[0]];
      status.inspections.target=await command('project.select',{slot:'target',ref:status.selection.target});
     }
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/select'){
     if(status.executing)throw new Error('drill_already_running');
     const slot=form.get('slot'),ref=form.get('ref');
     if(!['source','target'].includes(slot)||!status.connections[slot]||!projects[slot].some(p=>p.ref===ref))throw new Error('project_not_authorized');
     if(slot==='target')status.allowOverwrite=form.get('allowOverwrite')==='yes';
     const inspected=await command('project.select',{slot,ref});
     status.inspections||={};status.inspections[slot]=inspected;
     if(status.selection[slot]!==ref){delete status.preflight;if(slot==='source'){status.inventory=null;status.scope=null;}}
     status.selection[slot]=ref;
     if(slot==='source'){
      delete status.selection.sources;
      delete status.selection.targetMap;
     }else if(status.selection.sources?.length>1){
      status.selection.targetMap={...status.selection.targetMap,[status.selection.source]:ref};
     }
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/mode'){
     if(status.executing)throw new Error('drill_already_running');
     const mode=form.get('mode');
     if(!['dropbox','temporary_runner','capsule_only','restore_only'].includes(mode))throw new Error('invalid_mode');
     status.mode=mode;
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname==='/scope'){
     if(form.has('databaseName')&&form.get('databaseName')!=='postgres')throw new Error('unsupported_database');
     if(status.executing||!status.inventory||status.inventory.ref!==status.selection.source)throw new Error('source_inventory_required');
     const indices=(key,max)=>form.getAll(key).map(value=>{
      if(!/^(0|[1-9][0-9]*)$/.test(value))throw new Error('invalid_source_scope');
      const index=Number(value);if(!Number.isSafeInteger(index)||index<0||index>=max)throw new Error('invalid_source_scope');return index;
     });
     const tableIndices=indices('tableIndex',status.inventory.tables.length);
     const excludedTableIndices=indices('excludedTableIndex',status.inventory.tables.length);
     const bucketIndices=indices('bucketIndex',status.inventory.buckets.length);
     const tables=[...new Set(tableIndices)].map(index=>status.inventory.tables[index].name);
     const excludedTables=[...new Set(excludedTableIndices)].map(index=>status.inventory.tables[index].name).filter(name=>!tables.includes(name));
     const buckets=[...new Set(bucketIndices)].map(index=>status.inventory.buckets[index].id);
     if(tables.length!==status.inventory.tables.length&&status.inventory.tables.some(row=>!row.selectable))throw new Error('selective_table_names_unsupported');
     if(buckets.length!==status.inventory.buckets.length&&buckets.some(id=>!status.inventory.buckets.find(row=>row.id===id)?.selectable))throw new Error('selective_bucket_names_unsupported');
     status.scope={tables,excludedTables,buckets,auth:form.get('auth')==='yes',functions:form.get('functions')==='yes'};
     await preflight();res.writeHead(303,{location:'/'});return res.end();
    }
    if(url.pathname!=='/execute')throw new Error('unsupported_action');
    const vaultChoice=form.get('vault')||status.mode||'temporary_runner';
    if(!['dropbox','temporary_runner','capsule_only','restore_only'].includes(vaultChoice))throw new Error('capsule_choice_required');
    const isRestoreOnly=vaultChoice==='restore_only';
    const isCapsuleOnly=vaultChoice==='capsule_only';
    validateProjectMapping({sourceRef:status.selection.source,targetRef:status.selection.target,sourceRefs:status.selection.sources,targetMap:status.selection.targetMap,mode:vaultChoice,authorizedTargets:projects.target.map(p=>p.ref)});
    if(!isRestoreOnly){
     if(form.get('confirmSource')!==status.selection.source||form.get('acknowledgeScope')!=='yes')throw new Error('test_confirmation_required');
     if(!status.inventory||!status.scope)throw new Error('source_scope_required');
    }
    const allowOverwrite=form.get('allowOverwrite')==='yes';
    status.allowOverwrite=allowOverwrite;
    if(status.state!=='preflight_passed')throw new Error('preflight_required');
    if(!isCapsuleOnly&&!(status.preflight?.target?.blank===true||allowOverwrite))throw new Error('preflight_required');
    if(status.executing)throw new Error('drill_already_running');
    if(['dropbox','capsule_only'].includes(vaultChoice)&&!status.connections.dropbox&&!status.connections.s3)throw new Error('dropbox_connection_required');
    const dropboxCapsuleId=form.get('dropboxCapsuleId')||undefined;
    executeDryRun({command,status,persist,sourceRef:status.selection.source,targetRef:status.selection.target,vault:vaultChoice,mode:vaultChoice,scope:status.scope,allowOverwrite,dropboxCapsuleId,vaultProvider:status.activeVault,sourceRefs:status.selection?.sources,targetMap:status.selection?.targetMap}).catch(()=>{});
    res.writeHead(303,{location:'/'});return res.end();
   }
   if(req.method!=='GET'){res.writeHead(405);return res.end();}
   if(url.pathname==='/scope-ui.js'){
    res.setHeader('content-type','text/javascript; charset=utf-8');
    return res.end(await readFile(new URL('./evidence/ui/scope-ui.js',import.meta.url)));
   }
   if(url.pathname==='/gcp-logo.png'||url.pathname==='/intel-tdx-logo.png'){
    res.setHeader('content-type','image/png');
    return res.end(await readFile(new URL(`./evidence/ui${url.pathname}`,import.meta.url)));
   }
   if(url.pathname==='/attestation-certificate'){
    res.setHeader('content-type','text/html; charset=utf-8');
    res.setHeader('content-disposition','attachment; filename="portabase-tdx-attestation-certificate.html"');
    return res.end(renderAttestationCertificate(status));
   }
   if(url.pathname==='/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(status));}
   if(url.pathname==='/confidential/callback'){
    if(url.searchParams.has('error'))throw new Error('oauth_authorization_denied');
    await finishCallback({state:url.searchParams.get('state'),code:url.searchParams.get('code')});
    res.writeHead(303,{location:'http://127.0.0.1:58441/?oauth_complete=supabase'});return res.end();
   }
   if(url.pathname==='/oauth/dropbox/callback'){
    if(url.searchParams.has('error')||url.searchParams.has('error_name'))throw new Error(url.searchParams.get('error_name')||url.searchParams.get('error')||'dropbox_oauth_denied');
    await command('vault.finish',{code:url.searchParams.get('code'),state:url.searchParams.get('state')});
    status.connections.dropbox=true;delete links.dropbox;delete offers.dropbox;
    await preflight();await persist();
    res.writeHead(303,{location:'http://127.0.0.1:58441/?oauth_complete=dropbox'});return res.end();
   }
   if(url.pathname!=='/'){res.writeHead(404);return res.end();}
   // Fresh offers when a reviewer resumes after consent expiry.
   if(status.state!=='starting'){
    try{
     for(const slot of ['source','target'])if(needsOAuthOffer({connected:status.connections[slot],link:links[slot],offeredAt:offers[slot]}))await begin(slot);
     if(!status.connections.dropbox&&(!links.dropbox||Date.now()-offers.dropbox>8*60000))await beginDropbox();
    }catch(err){status.error=err.message;}
   }
   res.setHeader('content-type','text/html; charset=utf-8');
   res.end(renderDryRunPage({status,projects,selection:status.selection,links,nonce:runNonce}));
  }catch(e){status.error=/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:
   ['TimeoutError','AbortError','TypeError','SyntaxError'].includes(e.name)?`request_${e.name.toLowerCase()}`:'validation_request_failed';await persist();
   res.writeHead(400,{'content-type':'text/plain'});res.end(status.error);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(58441,'127.0.0.1',resolve);});
 const server6=createServer(server.listeners('request')[0]);
 server6.on('error',()=>{});
 server6.listen(58441,'::1');
 await ensureRunnerSession();
 for(const slot of ['source','target'])if(!status.connections[slot])await begin(slot);
 if(!status.connections.dropbox)await beginDropbox();
 for(const slot of ['source','target'])if(status.connections[slot]){await refreshIdentity(slot);await refreshProjects(slot);}
 await preflight();await persist();
 console.log(JSON.stringify({state:status.state,url:'http://127.0.0.1:58441',attestation:status.attestation}));
 if(operatingMode!=='development')setTimeout(()=>{server.close();try{server6.close();}catch{}},230*60000).unref();
}
main().catch(e=>{console.error(/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:
 ['TimeoutError','AbortError','TypeError','SyntaxError'].includes(e.name)?`customer_session_${e.name.toLowerCase()}`:'customer_session_failed');process.exitCode=1;});
