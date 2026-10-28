import test from 'node:test';
import assert from 'node:assert/strict';
import {destinationBeacons,BEACON_QUERY} from './destination-beacon.mjs';
import {beaconCrypto} from './beacon-crypto.mjs';
import {beaconScheduler,beaconUsage} from './beacon-scheduler.mjs';
import {beaconInstanceConfiguration,beaconRunnerName,runnerName} from './compute-control.mjs';
import {runBeaconWorker} from './beacon-worker.mjs';
import {BEACON_INTERVAL_MS} from './beacon-config.mjs';
import {schedulerIdentity} from './beacon-scheduler-identity.mjs';
import {generateKeyPair,SignJWT} from 'jose';

const owner='a'.repeat(64),ref='b'.repeat(20),lease='cccccccc-cccc-cccc-cccc-cccccccccccc';
const image='us-central1-docker.pkg.dev/portabase-dev/portabase-confidential/application@sha256:'+'d'.repeat(64);
function memoryStorage(){
  const rows=new Map();let revision=0;
  return {rows,async get(kind,id){return structuredClone(rows.get(kind+'/'+id)||null);},
    async put(kind,id,data,generation='0'){
      const key=kind+'/'+id,old=rows.get(key);
      if((old?.generation||'0')!==generation)return {modified:false};
      const next=String(++revision);rows.set(key,{data:structuredClone(data),generation:next});return {modified:true,generation:next};
    },async list(){return {owners:[...rows.keys()].filter(x=>x.startsWith('delegations/')).map(x=>x.split('/')[1]),cursor:null};}};
}
const fakeCrypt={seal:async(owner,data)=>({sealed:structuredClone(data)}),open:async(owner,data)=>structuredClone(data.sealed)};
function fixture(){
  let clock=Date.parse('2026-10-28T00:00:00Z'),queries=0;
  const storage=memoryStorage(),profile={owner,selection:{source:'s'.repeat(20)},connections:{target:{accessToken:'private-fixture-token',refreshToken:'private-refresh',grantId:'fixture'},source:{accessToken:'never-delegate-source'}},recoveryKey:'never-delegate-key'};
  const connections={access:async(p,slot)=>{assert.equal(slot,'target');return {api:{projects:async()=>[{ref}],query:async(r,sql)=>{assert.equal(r,ref);assert.equal(sql,BEACON_QUERY);queries++;return [{beacon:1}];}}};}};
  const beacons=destinationBeacons({crypt:fakeCrypt,storage,now:()=>clock});
  return {storage,profile,connections,beacons,now:()=>clock,advance:ms=>clock+=ms,queries:()=>queries};
}

test('beacon enrollment requires consent and exact authorized target; stores no source or recovery key',async()=>{
  const f=fixture();
  await assert.rejects(f.beacons.configure(f.profile,{enabled:true,refs:[ref]},f.connections),/consent/);
  await assert.rejects(f.beacons.configure(f.profile,{enabled:true,refs:['x'.repeat(20)],acknowledgeDelegation:true},f.connections),/not_authorized/);
  await assert.rejects(f.beacons.configure(f.profile,{enabled:true,refs:[f.profile.selection.source],acknowledgeDelegation:true},f.connections),/unsafe_beacon_target/);
  await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  const grant=(await f.storage.get('delegations',owner)).data.envelope.sealed;
  assert.deepEqual(Object.keys(grant.connections),['target']);
  assert.ok(!JSON.stringify(grant).includes('never-delegate'));
});

test('beacon executes a database query once per 72 hours and persists refreshed grant',async()=>{
  const f=fixture();
  await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  const access=f.connections.access;f.connections.access=async(p,slot)=>{p.connections.target.refreshToken='rotated';return access(p,slot);};
  const receipt=await f.beacons.run(owner,lease,f.connections);
  assert.equal(receipt.status,'succeeded');assert.equal(receipt.billableBytes,0);assert.equal(receipt.outboundBytes,null);assert.equal(f.queries(),1);
  const record=await f.storage.get('delegations',owner);assert.equal(record.data.envelope.sealed.connections.target.refreshToken,'rotated');
  await assert.rejects(f.beacons.run(owner,lease,f.connections),/not_due/);
  f.advance(BEACON_INTERVAL_MS);await f.beacons.run(owner,lease,f.connections);assert.equal(f.queries(),2);
});

test('revocation and permission loss prevent database access; errors stay bounded',async()=>{
  const f=fixture();await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  f.connections.access=async()=>({api:{projects:async()=>[],query:async()=>assert.fail('must not query revoked destination')}});
  const result=await f.beacons.run(owner,lease,f.connections);assert.equal(result.status,'failed');assert.equal(result.outcomes[0].errorCode,'project_not_authorized');
  await f.beacons.configure(f.profile,{enabled:false},f.connections);
  await assert.rejects(f.beacons.run(owner,lease,f.connections),/disabled/);
});

test('disable and re-enable cannot reset the free beacon cadence',async()=>{
  const f=fixture(),settings={enabled:true,refs:[ref],acknowledgeDelegation:true};
  await f.beacons.configure(f.profile,settings,f.connections);await f.beacons.run(owner,lease,f.connections);
  await f.beacons.configure(f.profile,{enabled:false},f.connections);
  await f.beacons.configure(f.profile,settings,f.connections);
  await assert.rejects(f.beacons.run(owner,lease,f.connections),/not_due/);assert.equal(f.queries(),1);
});

test('envelope contents are encrypted and authenticated to owner; WIF denied fails closed',async()=>{
  let attestations=0;
  const crypt=beaconCrypto({attest:async()=>{attestations++;return 'attestation';},fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);
    if(url.includes('sts.googleapis.com'))return Response.json({access_token:'fixture',expires_in:3600});
    return Response.json(url.endsWith(':encrypt')?{ciphertext:body.plaintext}:{plaintext:body.ciphertext});
  }});
  const envelope=await crypt.seal(owner,{version:1,owner,credential:'secret-test-grant',refs:[ref]});
  assert.ok(!JSON.stringify(envelope).includes('secret-test-grant'));assert.ok(!JSON.stringify(envelope).includes(ref));
  assert.equal((await crypt.open(owner,envelope)).credential,'secret-test-grant');assert.equal(attestations,1);
  await assert.rejects(crypt.open('e'.repeat(64),envelope),/invalid/);
  await assert.rejects(crypt.open(owner,{...envelope,tag:Buffer.alloc(16).toString('base64')}),/invalid/);
  const denied=beaconCrypto({attest:async()=>'attestation',fetchImpl:async()=>new Response('',{status:403})});
  await assert.rejects(denied.seal(owner,{version:1,owner}),/identity_denied/);
});

test('dedicated beacon runner cannot name the backup runner and has ten minute maximum',()=>{
  const config=beaconInstanceConfiguration(owner,image,lease);
  assert.equal(config.name,beaconRunnerName(owner));assert.notEqual(config.name,runnerName(owner));
  assert.equal(config.scheduling.maxRunDuration.seconds,'600');assert.equal(config.scheduling.instanceTerminationAction,'DELETE');
  assert.equal(config.labels.purpose,'destination-beacon');
  assert.throws(()=>beaconInstanceConfiguration(owner,image,'invalid'),/lease/);
});

test('concurrent schedule ticks allocate once and cleanup only exact beacon lease',async()=>{
  const f=fixture();await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  let creates=0,removes=0,instance=null;
  const compute={getBeacon:async()=>instance,createBeacon:async(o,id)=>{creates++;instance={leaseId:id,createdAt:new Date(f.now()).toISOString()};},removeBeacon:async(o,id)=>{assert.equal(id,lease);removes++;instance=null;},remove:()=>assert.fail('never delete backup runner')};
  const tick=beaconScheduler({storage:f.storage,compute,now:f.now,uuid:()=>lease});
  await Promise.all([tick(),tick()]);assert.equal(creates,1);
  const receipt=await runBeaconWorker({owner,leaseId:lease,storage:f.storage,crypt:fakeCrypt,connections:f.connections,now:f.now});
  assert.equal(receipt.status,'succeeded');await tick();assert.equal(removes,1);await tick();
  const usage=await beaconUsage(owner,f.storage,f.now());assert.equal(usage.jobsSucceeded,1);assert.equal(usage.chargedBytes,0);
});

test('scheduler preserves unknown existing beacon instance and worker refuses forged lease',async()=>{
  const f=fixture();await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  const tick=beaconScheduler({storage:f.storage,now:f.now,compute:{getBeacon:async()=>({leaseId:'other'}),createBeacon:async()=>assert.fail('duplicate VM'),removeBeacon:async()=>assert.fail('unknown VM')}});
  assert.equal((await tick()).busy,1);
  await assert.rejects(runBeaconWorker({owner,leaseId:lease,storage:f.storage,crypt:fakeCrypt,connections:f.connections,now:f.now}),/lease_invalid/);
  assert.equal(f.queries(),0);
});

test('crashed runner reaches bounded deadline then backs off instead of repeated immediate allocation',async()=>{
  const f=fixture();await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  let creates=0;
  const tick=beaconScheduler({storage:f.storage,now:f.now,uuid:()=>lease,compute:{getBeacon:async()=>null,createBeacon:async()=>{creates++;throw Error('ambiguous');},removeBeacon:async()=>{}}});
  await tick();await tick();assert.equal(creates,1);
  f.advance(13*60000);await tick();await tick();assert.equal(creates,1);
  assert.equal((await beaconUsage(owner,f.storage,f.now())).jobsFailed,1);
});

test('scheduler identity rejects customer tokens, wrong audience and unverified email',async()=>{
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const audience='https://portabase-confidential-controller-fixture-uc.a.run.app/beacon/tick';
  const verify=schedulerIdentity({audience,keyResolver:async()=>publicKey});
  const jwt=async(email,emailVerified=true,aud=audience)=>new SignJWT({email,email_verified:emailVerified}).setProtectedHeader({alg:'RS256'}).setSubject('1234567890').setIssuer('https://accounts.google.com').setAudience(aud).setIssuedAt().setExpirationTime('1h').sign(privateKey);
  const email='pb-beacon-scheduler@portabase-dev.iam.gserviceaccount.com';
  assert.equal(await verify('Bearer '+await jwt(email)),true);
  await assert.rejects(verify('Bearer '+await jwt('customer@example.com')));
  await assert.rejects(verify('Bearer '+await jwt(email,false)));
  await assert.rejects(verify('Bearer '+await jwt(email,true,'https://other.example')));
});

test('foreground and beacon share one rotating grant lease and receipts cannot overwrite refreshed tokens',async()=>{
  const f=fixture();await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
  let release,entered;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});let refreshes=0;
  const original=f.connections.access;
  f.connections.access=async(p,slot)=>{refreshes++;entered();await gate;p.connections.target.refreshToken='rotated-once';p.connections.target.accessToken='new-access';return original(p,slot);};
  const foreground=f.beacons.access(f.profile,f.connections);await started;
  const beacon=await f.beacons.run(owner,lease,f.connections);assert.equal(beacon.status,'failed');assert.equal(refreshes,1);
  release();await foreground;
  let stored=(await f.storage.get('delegations',owner)).data.envelope.sealed;
  assert.equal(stored.connections.target.refreshToken,'rotated-once');assert.equal(stored.lastResult.status,'failed');assert.equal(stored.refreshLease,undefined);
  await f.beacons.configure(f.profile,{enabled:false},f.connections);
  assert.equal(f.profile.connections.target.refreshToken,'rotated-once');
  await assert.rejects(f.beacons.run(owner,lease,f.connections),/disabled/);
  // A stale sealed profile still resolves the authoritative grant after disable.
  f.profile.connections.target.refreshToken='stale-original';f.connections.access=async(p,slot)=>{assert.equal(p.connections.target.refreshToken,'rotated-once');return original(p,slot);};
  await f.beacons.access(f.profile,f.connections);assert.equal(f.profile.connections.target.refreshToken,'rotated-once');
});

test('failed refresh or persistence never releases an unpersisted rotating grant or retries stale token',async()=>{
  for(const failure of ['provider','persistence']){
    const f=fixture();await f.beacons.configure(f.profile,{enabled:true,refs:[ref],acknowledgeDelegation:true},f.connections);
    const put=f.storage.put;let calls=0,accesses=0;
    if(failure==='persistence')f.storage.put=async(...args)=>{calls++;if(calls>1)throw Error('store_offline');return put(...args);};
    f.connections.access=async p=>{accesses++;p.connections.target.refreshToken='rotated-but-uncommitted';if(failure==='provider')throw Error('ambiguous_provider_response');return {token:'new-access',api:{}};};
    await assert.rejects(f.beacons.access(f.profile,f.connections));assert.equal(f.profile.connections.target.refreshToken,'private-refresh');
    await assert.rejects(f.beacons.access(f.profile,f.connections),/busy/);assert.equal(accesses,1);
    f.advance(6*60000);await assert.rejects(f.beacons.access(f.profile,f.connections),/reauthorization_required/);assert.equal(accesses,1);
    f.storage.put=put;await f.beacons.revokeForReplacement(f.profile);assert.equal(f.profile.beacon.enabled,false);
  }
});

test('settings preserve a refresh completed after target access and reject concurrent revocation or active lease',async()=>{
  for(const change of ['refresh','revocation','active-lease','replacement']){
    const f=fixture(),settings={enabled:true,refs:[ref],acknowledgeDelegation:true};
    await f.beacons.configure(f.profile,settings,f.connections);
    const original=f.connections.access;
    f.connections.access=async()=>({api:{projects:async()=>{
      if(change==='refresh'){
        await f.beacons.access(structuredClone(f.profile),{access:async(p,slot)=>{
          p.connections.target.refreshToken='new-authoritative-refresh';
          p.connections.target.accessToken='new-authoritative-access';
          return original(p,slot);
        }});
      }else if(change==='revocation')await f.beacons.configure(structuredClone(f.profile),{enabled:false},f.connections);
      else{
        const row=await f.storage.get('delegations',owner);
        if(change==='active-lease')row.data.envelope.sealed.refreshLease={id:lease,expiresAt:f.now()+60000};
        else row.data.envelope.sealed.connections.target.grantId='different-grant';
        await f.storage.put('delegations',owner,row.data,row.generation);
      }
      return [{ref}];
    }}});
    if(change==='refresh'){
      await f.beacons.configure(f.profile,settings,f.connections);
      const target=(await f.storage.get('delegations',owner)).data.envelope.sealed.connections.target;
      assert.equal(target.refreshToken,'new-authoritative-refresh');
      assert.equal(target.accessToken,'new-authoritative-access');
    }else await assert.rejects(f.beacons.configure(f.profile,settings,f.connections),/settings_changed|grant_busy|target_grant_changed/);
  }
});

test('KMS workload identity policy rejects command and environment overrides independently of image digest',async()=>{
  const {readFile}=await import('node:fs/promises');
  const script=await readFile(new URL('./provision-beacon.ps1',import.meta.url),'utf8');
  const condition=script.split('\n').find(line=>line.startsWith('$condition='));
  for(const claim of ['cmd_override','env_override']){
    assert.ok(condition.includes(`(!has(assertion.submods.container.${claim}) || size(assertion.submods.container.${claim}) == 0)`));
  }
  assert.ok(condition.includes("assertion.submods.container.args == ['node','/app/cloud/confidential/production-workload.mjs']"));
  assert.ok(condition.includes("assertion.submods.container.image_digest == '$ApplicationDigest'"));
  assert.ok(script.includes('"--attribute-condition=$condition"'));
});
