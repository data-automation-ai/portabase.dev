// Operator-only, isolated test identity. Tokens, recovery key and OAuth codes
// remain in memory; the code/token exchange occurs inside the attested VM.
import {createServer} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {operatorGoogle} from './operator-google.mjs';
import {confidentialClient} from './client.mjs';
import {executeDryRun} from './execute-dry-run.mjs';
const CONTROLLER='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const DIGEST='sha256:70ab9d63d32db4beb3206f21bd67de0128a508a966a9915050a8d0382545076b';
const REF='eoiqvdmvgaurlecdzqkp',ID='6f454f7b-b490-4fe9-9c49-48ce5b6f4408';
// Supabase's live authorize endpoint rejects HTTP loopback callbacks even
// when registered. The test verifier receives the HTTPS callback by handoff.
const CALLBACK='https://portabase.dev/confidential/callback';
const selected={source:'uloqvqdkeiwvnnnfdvrc',target:'jmqjsyyyhhwvkbqexxog'};
const expected={source:'portabase-confidential-source',target:'portabase-confidential-target'};
const status={state:'starting',connections:{source:false,target:false},allocation:'customer-authenticated admission',backupExecuted:false,restoreExecuted:false};
const pending=new Map(),links={};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
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
  if(sealedProfile&&(operation==='oauth.finish'||Date.now()-lastProfileSave>30000)){
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
 Object.assign(status,{state:'awaiting_oauth',attestation:client.evidence(),connections:opened.connected});
 async function begin(slot){
  const offer=await command('oauth.begin',{slot,redirectUri:CALLBACK});
  pending.set(offer.state,slot);links[slot]=offer.url;
 }
 async function preflight(){
  if(!status.connections.source||!status.connections.target)return;
  for(const slot of ['source','target']){
   const projects=await command('projects.list',{slot});
   if(!projects.projects.some(p=>p.ref===selected[slot]&&p.name===expected[slot]))throw new Error('fixture_project_mismatch');
   await command('project.select',{slot,ref:selected[slot]});
  }
  const result=await command('preflight');
  status.preflight={ready:result.ready,source:result.source,target:result.target,dataFlow:result.dataFlow};
  status.state=result.ready?'preflight_passed':'preflight_blocked';
  await persist();
 }
 async function persist(){await writeFile(new URL('./evidence/customer-session-live.json',import.meta.url),JSON.stringify({...status,checkedAt:new Date().toISOString()},null,2)+'\n');}
 for(const slot of ['source','target'])if(!status.connections[slot])await begin(slot);
 await preflight();await persist();
 const server=createServer(async(req,res)=>{
  if(req.headers.host!=='127.0.0.1:58441'){res.writeHead(400);return res.end();}
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');res.setHeader('x-content-type-options','nosniff');
  res.setHeader('content-security-policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'");
  const url=new URL(req.url,'http://127.0.0.1:58441');
  try{
   if(req.method==='POST'&&url.pathname==='/execute'){
    if(req.headers.origin&&req.headers.origin!=='http://127.0.0.1:58441'){res.writeHead(403);return res.end();}
    if(!req.headers['content-type']?.startsWith('application/json')){res.writeHead(415);return res.end();}
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024)throw new Error('request_too_large');}
    const input=JSON.parse(raw);if(input.confirmTarget!==selected.target||input.syntheticOnly!==true)throw new Error('test_confirmation_required');
    if(status.executing)throw new Error('drill_already_running');
    executeDryRun({command,status,persist}).catch(()=>{});
    res.writeHead(202,{'content-type':'application/json'});return res.end(JSON.stringify({started:true}));
   }
   if(req.method!=='GET'){res.writeHead(405);return res.end();}
   if(url.pathname==='/status'){res.setHeader('content-type','application/json');return res.end(JSON.stringify(status));}
   if(url.pathname==='/confidential/callback'){
    const state=url.searchParams.get('state'),slot=pending.get(state);if(!slot)throw new Error('oauth_state_mismatch');
    if(url.searchParams.has('error'))throw new Error('oauth_authorization_denied');
    await command('oauth.finish',{slot,state,code:url.searchParams.get('code')});pending.delete(state);
    status.connections[slot]=true;delete links[slot];await preflight();await persist();
    res.writeHead(303,{location:'/'});return res.end();
   }
   if(url.pathname!=='/'){res.writeHead(404);return res.end();}
   // Fresh offers when a reviewer resumes after consent expiry.
   for(const slot of ['source','target'])if(!status.connections[slot])await begin(slot);
   res.setHeader('content-type','text/html; charset=utf-8');
   res.end(`<!doctype html><title>Portabase live recovery validation</title><style>body{font:18px system-ui;max-width:850px;margin:60px auto;background:#f5faf8;color:#173c32}a{display:block;padding:20px;background:#066c56;color:white;margin:15px 0}pre{white-space:pre-wrap;font-size:14px}</style><h1>Live Google enclave validation</h1><p>Google attestation verified for the pinned application image. Only the two named test projects are selected.</p><p>State: ${esc(status.state)}</p>${['source','target'].map(slot=>status.connections[slot]?`<p>${slot}: connected</p>`:`<a href="${esc(links[slot])}">Authorize ${slot}: ${esc(expected[slot])}</a>`).join('')}<p>Supabase grants organization-wide permissions. Authorization is a separate approval from choosing these test projects.</p><p>No backup or restore has run yet.</p><pre>${esc(JSON.stringify(status.attestation,null,2))}</pre>`);
  }catch(e){status.error=/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:'validation_request_failed';await persist();
   res.writeHead(400,{'content-type':'text/plain'});res.end(status.error);}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(58441,'127.0.0.1',resolve);});
 console.log(JSON.stringify({state:status.state,url:'http://127.0.0.1:58441',attestation:status.attestation}));
 setTimeout(()=>server.close(),60*60000).unref();
}
main().catch(e=>{console.error(/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:'customer_session_failed');process.exitCode=1;});
