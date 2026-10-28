import { randomUUID } from 'node:crypto';
import { projectRef } from './supabase-access.mjs';
import { beaconStorage } from './beacon-storage.mjs';
import { beaconCrypto } from './beacon-crypto.mjs';
import { BEACON_INTERVAL_MS, beaconOwner } from './beacon-config.mjs';

export const BEACON_QUERY = "SELECT 1 AS beacon FROM pg_catalog.pg_class WHERE oid = 'pg_catalog.pg_class'::regclass LIMIT 1";
const fail = code => { throw Error(code); };
const errorCode = e => ['project_not_authorized', 'supabase_connection_required', 'connection_changed', 'beacon_response_invalid'].includes(e?.message) ? e.message : 'beacon_query_failed';
const targetCopy = token => Object.fromEntries(['accessToken','refreshToken','expiresAt','tokenType','grantId'].filter(k=>token?.[k]!==undefined).map(k=>[k,token[k]]));
const GRANT_LEASE_MS=5*60*1000;
export function destinationBeacons({ crypt = beaconCrypto(), storage, now = Date.now } = {}) {
  const store = storage || beaconStorage({ token: crypt.token });
  const read=async owner=>{const record=await store.get('delegations',owner);return record?{record,grant:await crypt.open(owner,record.data.envelope)}:null;};
  const save=async(owner,record,grant)=>store.put('delegations',owner,{...record?.data,version:1,enabled:grant.enabled,nextDueAt:grant.nextDueAt||null,envelope:await crypt.seal(owner,grant)},record?.generation||'0');
  function noLease(grant){if(grant?.refreshLease)fail(grant.refreshLease.expiresAt>now()?'beacon_grant_busy':'beacon_grant_reauthorization_required');}
  // Both foreground jobs and scheduled beacons use this one refresh owner.
  async function grantAccess(owner,connections){
    const current=await read(owner);if(!current?.grant.connections?.target)fail('beacon_grant_unavailable');
    noLease(current.grant);const id=randomUUID(),revision=current.grant.revision;
    current.grant.refreshLease={id,expiresAt:now()+GRANT_LEASE_MS};
    if(!(await save(owner,current.record,current.grant)).modified)fail('beacon_grant_busy');
    let access;
    // On an ambiguous provider/network failure leave the lease in place: the
    // provider may have rotated its token, so reusing the old one is unsafe.
    try{access=await connections.access(current.grant,'target',{delegated:false});}
    catch{fail('beacon_grant_reauthorization_required');}
    const target=targetCopy(current.grant.connections.target);
    for(let attempt=0;attempt<5;attempt++){
      const latest=await read(owner);
      if(!latest||latest.grant.revision!==revision||latest.grant.refreshLease?.id!==id)fail('beacon_grant_changed');
      latest.grant.connections.target=target;delete latest.grant.refreshLease;
      const saved=await save(owner,latest.record,latest.grant);
      if(saved.modified)return {access,target,enabled:latest.grant.enabled};
    }
    // No caller receives a rotated grant before durable persistence succeeds.
    fail('beacon_grant_persist_required');
  }
  const api={
    async access(profile,connections){
      const owner=beaconOwner(profile.owner),current=await read(owner);
      if(!current?.grant.connections?.target)return null;
      if(current.grant.connections.target.grantId!==profile.connections?.target?.grantId)fail('beacon_target_grant_changed');
      const result=await grantAccess(owner,connections);
      profile.connections.target={...profile.connections.target,...result.target};
      if(!result.enabled)profile.beacon={...profile.beacon,enabled:false};
      return result.access;
    },
    async revokeForReplacement(profile){
      const owner=beaconOwner(profile.owner),current=await read(owner);
      if(!current)return;
      if(current.grant.refreshLease?.expiresAt>now())fail('beacon_grant_busy');
      // Explicit reauthorization replaces a possibly lost rotating grant.
      const grant={version:1,owner,enabled:false,refs:[],revokedAt:now(),nextDueAt:current.grant.nextDueAt||now(),revision:randomUUID()};
      if(!(await save(owner,current.record,grant)).modified)fail('beacon_settings_changed');
      profile.beacon={enabled:false,refs:[],intervalHours:72};
    },
    async configure(profile,input,connections){
      const owner=beaconOwner(profile.owner);
      if(!input||typeof input.enabled!=='boolean'||Object.keys(input).some(k=>!['enabled','refs','acknowledgeDelegation'].includes(k)))fail('invalid_beacon_settings');
      let current=await read(owner),grant;
      if(!input.enabled){
        noLease(current?.grant);
        // Keep an inert encrypted recovery copy until the customer's sealed
        // profile has synchronized; disabled records cannot schedule queries.
        grant={version:1,owner,enabled:false,refs:[],revokedAt:now(),nextDueAt:current?.grant.nextDueAt||now(),revision:randomUUID(),
          ...(current?.grant.connections?.target?{connections:{target:targetCopy(current.grant.connections.target)}}:{})};
      }else{
        if(input.acknowledgeDelegation!==true||!Array.isArray(input.refs)||input.refs.length<1||input.refs.length>12)fail('beacon_delegation_consent_required');
        const refs=[...new Set(input.refs.map(projectRef))];
        if(refs.some(ref=>ref===profile.selection?.source||ref==='eoiqvdmvgaurlecdzqkp'))fail('unsafe_beacon_target');
        const startingRevision=current?.grant.revision;
        const access=await connections.access(profile,'target'),projects=await access.api.projects();
        if(refs.some(ref=>!projects.some(p=>p.ref===ref)))fail('project_not_authorized');
        const token=profile.connections?.target;
        if(!token?.accessToken||(!token.refreshToken&&token.tokenType!=='pat'))fail('supabase_connection_required');
        current=await read(owner);noLease(current?.grant);
        // A refresh may finish while the permission request is in flight.
        // Preserve its durable token; never replace it with this profile's
        // earlier snapshot. Concurrent revocation/settings changes win.
        if(current?.grant.revision!==startingRevision)fail('beacon_settings_changed');
        const authoritative=current?.grant.connections?.target;
        if(authoritative&&authoritative.grantId!==token.grantId)fail('beacon_target_grant_changed');
        grant={version:1,owner,enabled:true,refs,connections:{target:targetCopy(authoritative||token)},selection:{},authorizedAt:now(),
          nextDueAt:Number.isFinite(current?.grant.nextDueAt)?current.grant.nextDueAt:now(),revision:randomUUID()};
      }
      if(!(await save(owner,current?.record,grant)).modified)fail('beacon_settings_changed');
      if(!input.enabled&&grant.connections?.target)profile.connections.target={...profile.connections.target,...grant.connections.target};
      profile.beacon={enabled:grant.enabled,refs:grant.refs,intervalHours:72};
      return {...profile.beacon,nextDueAt:grant.nextDueAt?new Date(grant.nextDueAt).toISOString():null,delegated:grant.enabled};
    },
    async status(profile){
      const current=await read(beaconOwner(profile.owner));if(!current)return {enabled:false,intervalHours:72,destinations:[]};
      const grant=current.grant;
      return {enabled:grant.enabled,intervalHours:72,destinations:grant.refs,nextDueAt:grant.nextDueAt?new Date(grant.nextDueAt).toISOString():null,lastResult:grant.lastResult||null,
        ...(grant.refreshLease?{grantState:grant.refreshLease.expiresAt>now()?'busy':'reauthorization_required'}:{})};
    },
    async run(owner,leaseId,connections){
      beaconOwner(owner);const current=await read(owner);if(!current?.grant.enabled)fail('beacon_disabled');
      const grant=current.grant,started=now();
      if(!Number.isFinite(grant.nextDueAt)||grant.nextDueAt>started)fail('beacon_not_due');
      if(!Array.isArray(grant.refs)||!grant.refs.length||grant.refs.length>12)fail('beacon_delegation_invalid');
      grant.nextDueAt=started+BEACON_INTERVAL_MS;grant.lastAttemptId=leaseId;
      if(!(await save(owner,current.record,grant)).modified)fail('beacon_already_claimed');
      const outcomes=[];
      try{
        const {access:{api:sourceApi}}=await grantAccess(owner,connections),projects=await sourceApi.projects();
        for(const candidate of grant.refs){
          const ref=projectRef(candidate);
          if(ref==='eoiqvdmvgaurlecdzqkp'||!projects.some(p=>p.ref===ref)){outcomes.push({status:'failed',errorCode:'project_not_authorized'});continue;}
          const active=await read(owner);if(!active?.grant.enabled||active.grant.revision!==grant.revision)fail('beacon_settings_changed');
          try{const rows=await sourceApi.query(ref,BEACON_QUERY);if(!Array.isArray(rows)||rows.length!==1||Number(rows[0]?.beacon)!==1)fail('beacon_response_invalid');outcomes.push({status:'succeeded'});}
          catch(e){outcomes.push({status:'failed',errorCode:errorCode(e)});}
        }
      }catch(e){outcomes.push({status:'failed',errorCode:errorCode(e)});}
      const receipt={kind:'beacon',requestId:leaseId,status:outcomes.length===grant.refs.length&&outcomes.every(x=>x.status==='succeeded')?'succeeded':'failed',
        startedAt:new Date(started).toISOString(),finishedAt:new Date(now()).toISOString(),durationMs:Math.max(0,now()-started),
        destinationsSucceeded:outcomes.filter(x=>x.status==='succeeded').length,destinationsFailed:outcomes.filter(x=>x.status!=='succeeded').length,
        outboundBytes:null,billableBytes:0,outcomes};
      for(let attempt=0;attempt<5;attempt++){
        const latest=await read(owner);if(!latest||latest.grant.revision!==grant.revision)fail('beacon_settings_changed');
        latest.grant.lastResult=receipt;
        if((await save(owner,latest.record,latest.grant)).modified)return receipt;
      }
      fail('beacon_receipt_contention');
    },
  };return api;
}
