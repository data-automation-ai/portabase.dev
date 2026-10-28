import { confidentialClient } from '../../cloud/confidential/client.mjs';
import { validatePolicy } from '../../cloud/confidential/attestation.mjs';
const CONTROLLER = 'https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
const endpoint = '/api/cloud/confidential-session';
const excluded = row => ['skip','exclude'].includes(row.mode);
export function managedScope(workspace) {
  const selected = workspace.selection?.sources || [];
  if (selected.length > 1) throw Error('Choose one source project for this run.');
  const db = workspace.databases?.find(row => row.projectRef === workspace.selection?.source);
  if (!db || db.enabled === false || excluded(db)) throw Error('Select the source objects before starting.');
  if (db.mode === 'structure_only' || (db.tables || []).some(row => !excluded(row) && row.mode === 'structure_only'))
    throw Error('Hosted runs currently require structure and data for selected tables. Change the selection before running.');
  const tables = (db.tables || []).filter(row => !excluded(row) && (row.objectType || 'TABLE') === 'TABLE');
  const unsupported = (db.tables || []).filter(row => excluded(row) && (row.objectType || 'TABLE') !== 'TABLE');
  if (unsupported.length) throw Error('Hosted capture includes the complete database schema. Individually excluded views, functions, or schemas cannot be honored; use the CLI for this scope.');
  const buckets = new Map();
  for (const row of db.binaries || []) {
    const bucket = row.bucket || row.schema;
    const entry = buckets.get(bucket) || { included: false, excluded: false };
    entry[excluded(row) ? 'excluded' : 'included'] = true; buckets.set(bucket, entry);
  }
  if ([...buckets.values()].some(value => value.included && value.excluded))
    throw Error('Hosted capture currently selects complete Storage buckets. Select every file in a bucket or exclude the entire bucket.');
  return { tables: tables.map(row => row.name), buckets: [...buckets].filter(([,value]) => value.included).map(([bucket]) => bucket), auth: true, functions: true };
}
export function newRecoveryKey() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export function evidenceReport(evidence) {
  if (!evidence?.verifiedAt || !evidence.attestationToken || !evidence.imageDigest) throw Error('No verified attestation is available yet.');
  return { format:'portabase-verified-attestation-v1', issuer:'https://confidentialcomputing.googleapis.com',
    description:'Portabase verifier report with the Google-signed attestation token. This report is not itself issued by Google.',
    verifiedAt:evidence.verifiedAt, imageDigest:evidence.imageDigest, projectNumber:evidence.projectNumber,
    hardware:evidence.hardware, keyFingerprint:evidence.keyFingerprint, debugDisabled:evidence.debugDisabled,
    attestationToken:evidence.attestationToken };
}
export function createHostedRunner({ authorization, fetchImpl=fetch, clientFactory=confidentialClient,
  sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)), now=Date.now, onStatus=()=>{} }={}) {
  let client, config, connected={}, serial=Promise.resolve();
  const emit = value => onStatus(value);
  async function api(method, body) {
    const response = await fetchImpl(endpoint, { method, credentials:'same-origin', headers:{Authorization:await authorization(),'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}), cache:'no-store', redirect:'error', signal:AbortSignal.timeout(30000) });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || 'secure_session_unavailable');
    return data;
  }
  async function save(result) {
    if (!result?.sealedProfile) return result;
    const sealedProfile = result.sealedProfile;
    const stored = await api('PUT', { sealedProfile, profileRevision:config.profileRevision });
    config = {...config,sealedProfile,profileRevision:stored.profileRevision};
    const {sealedProfile:_,...publicResult}=result;return publicResult;
  }
  function command(operation,input={},options) {
    const next=serial.then(async()=>{
      if(!client)throw Error('Unlock the secure runner first.');
      const result=await save(await client.command(operation,input,options));
      emit({attestation:client.evidence()});return result;
    });
    serial=next.catch(()=>{});return next;
  }
  return {
    async unlock(recoveryKey, { signal }={}) {
      if(!/^[A-Za-z0-9_-]{43}$/.test(recoveryKey||''))throw Error('Enter the 43-character recovery key.');
      config=await api('GET');validatePolicy(config.policy);
      if(config.controllerUrl!==CONTROLLER||config.policy.projectNumber!=='495102144848'||config.policy.workload!=='application')throw Error('Runner release policy is invalid.');
      client=clientFactory({url:CONTROLLER,policy:config.policy,getAuthorization:authorization,fetchImpl});
      emit({state:'starting',message:'Starting your confidential runner. This can take several minutes.'});
      const requestId=crypto.randomUUID(),deadline=now()+8*60000;
      while(true){
        signal?.throwIfAborted();
        const status=await client.session(requestId);
        if(status.state==='ready')break;
        if(now()>deadline)throw Error('The runner did not become ready. Try again after checking its status.');
        await sleep(6000);
      }
      const opened=await command('session.open',{recoveryKey,...(config.sealedProfile?{sealedProfile:config.sealedProfile}:{})});
      connected=opened.connected||{};
      await command('key.acknowledge');
      emit({state:'unlocked',message:'Google attestation verified. Recovery key released only to the verified enclave.',attestation:client.evidence()});
      return opened;
    },
    command,
    async importConnection(provider,slot) {
      let bridgeId;
      const result=await command(provider==='supabase'?'oauth.import':'vault.import',{}, {envelopeFactory:async evidence=>{
        const data=await api('POST',{action:'bridge',provider,...(slot?{slot}:{}),...evidence});bridgeId=data.bridgeId;return data.envelope;
      }});
      await api('POST',{action:'complete-bridge',provider,...(slot?{slot}:{}),bridgeId});
      connected[slot||provider]=true;return result;
    },
    connected:()=>({...connected}),
    evidence:()=>client?.evidence(),
    exportProfile:()=>config?.sealedProfile ? {format:'portabase-encrypted-profile-v1',sealedProfile:config.sealedProfile}:null,
    async waitJob(job,kind,{signal}={}) {
      const deadline=now()+90*60000;
      while(true){
        signal?.throwIfAborted();const current=await command('job.status',{id:job.id});
        emit({state:kind==='backup'?'capturing':'restoring',[kind]:current});
        if(current.state==='complete')return current;
        if(current.state==='failed')throw Error(current.error||'The job failed. Review its receipt before retrying.');
        if(now()>deadline)throw Error('Monitoring timed out. The cloud job may still be running; do not start a duplicate.');
        await sleep(4000);
      }
    },
    async stop(){if(!client)return;await client.terminate();client=null;emit({state:'stopped',message:'Runner stopped.'});},
  };
}
