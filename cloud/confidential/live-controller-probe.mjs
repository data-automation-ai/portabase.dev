// Operator-only synthetic validation. Never shipped in the customer runner.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {writeFile} from 'node:fs/promises';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {operatorGoogle} from './operator-google.mjs';
import {computeControl} from './compute-control.mjs';
import {confidentialClient} from './client.mjs';
import {verifyOffer} from './attestation.mjs';
import {generateKeyPair,exportJWK} from 'jose';
const URL='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const DIGEST='sha256:70ab9d63d32db4beb3206f21bd67de0128a508a966a9915050a8d0382545076b';
const IMAGE='us-central1-docker.pkg.dev/portabase-dev/portabase-confidential/application@'+DIGEST;
const AUTH='eoiqvdmvgaurlecdzqkp',ID='6f454f7b-b490-4fe9-9c49-48ce5b6f4408';
const KEY='sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL';
const owner=createHash('sha256').update(ID).digest('hex');
async function googleToken(){
 const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  'gcloud auth print-access-token --account=rfiddomains@gmail.com --quiet'],{windowsHide:true,timeout:20000});
 return stdout.trim();
}
async function main(){
 const action=process.argv[2];
 const compute=computeControl({image:IMAGE,token:googleToken});
 if(action==='start'){
  const existing=await compute.get(owner);
  if(!existing)await compute.create(owner);
  console.log(JSON.stringify({action,allocation:'operator-provisioned isolated fixture; customer admission not proven',existing:!!existing}));return;
 }
 if(action==='remove'){await compute.remove(owner);console.log(JSON.stringify({deletionRequested:true}));return;}
 const google=await operatorGoogle();
 const secret=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-validation/versions/latest:access');
 const fixture=JSON.parse(Buffer.from(secret.payload.data,'base64').toString('utf8'));
 if(fixture.id!==ID||fixture.projectRef!==AUTH)throw new Error('fixture_identity_mismatch');
 const login=await fetch(`https://${AUTH}.supabase.co/auth/v1/token?grant_type=password`,{method:'POST',
  headers:{apikey:KEY,'content-type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password}),
  redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!login.ok)throw new Error('fixture_sign_in_failed');
 const session=await login.json();if(session.user?.id!==ID||!session.access_token)throw new Error('fixture_identity_mismatch');
 const client=confidentialClient({url:URL,policy:{hardware:'GCP_INTEL_TDX',projectNumber:'495102144848',imageDigest:DIGEST,workload:'application'},
  getAuthorization:async()=>`Bearer ${session.access_token}`});
 const status=await client.session(randomUUID());
 if(action==='check'||status.state!=='ready'){console.log(JSON.stringify(status));return;}
 if(action==='verify-negative'){
  const challenge=randomBytes(32).toString('base64url');
  const response=await fetch(URL+'/attest',{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,'content-type':'application/json'},
   body:JSON.stringify({challenge}),redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw new Error('live_offer_failed');const offer=await response.json();
  const policy={hardware:'GCP_INTEL_TDX',projectNumber:'495102144848',imageDigest:DIGEST,workload:'application'};
  const verified=await verifyOffer(offer,challenge,policy);
  let wrongImageRejected=false,substitutedKeyRejected=false;
  try{await verifyOffer(offer,challenge,{...policy,imageDigest:'sha256:'+'0'.repeat(64)});}catch(e){wrongImageRejected=e.message==='attestation_rejected:image_digest';}
  const replacement=await exportJWK((await generateKeyPair('RSA-OAEP-256',{modulusLength:3072})).publicKey);
  try{await verifyOffer({...offer,publicKey:replacement},challenge,policy);}catch(e){substitutedKeyRejected=e.message==='attestation_rejected:key_binding';}
  const evidence={checkedAt:new Date().toISOString(),attestation:verified.evidence,wrongImageRejected,substitutedKeyRejected,
   credentialsSent:false,passed:wrongImageRejected&&substitutedKeyRejected};
  await writeFile(new globalThis.URL('./evidence/application-live-negative-checks.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));if(!evidence.passed)process.exitCode=1;return;
 }
 if(action!=='attest')throw new Error('invalid_probe_action');
 const result=await client.command('session.open',{recoveryKey:randomBytes(32).toString('base64url')});
 const acknowledgement=await client.command('key.acknowledge');
 const jobs=await client.command('jobs.list');
 const evidence={checkedAt:new Date().toISOString(),controller:URL,allocation:'operator-provisioned isolated fixture; customer admission not proven',
  attestation:client.evidence(),encryptedSessionOpened:!!result.sealedProfile,encryptedAcknowledgement:acknowledgement.acknowledged===true,
  encryptedJobList:Array.isArray(jobs.jobs),oauthConnected:result.connected,backupExecuted:false,restoreExecuted:false};
 await writeFile(new globalThis.URL('./evidence/application-live-attestation.json',import.meta.url),JSON.stringify(evidence,null,2)+'\n');
 console.log(JSON.stringify(evidence,null,2));
}
main().catch(e=>{console.error(/^[a-z0-9_:.-]{3,120}$/i.test(e.message)?e.message:'live_probe_failed');process.exitCode=1;});
