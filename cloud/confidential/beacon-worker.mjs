import { beaconStorage } from './beacon-storage.mjs';
import { beaconCrypto } from './beacon-crypto.mjs';
import { destinationBeacons } from './destination-beacon.mjs';
import { oauthConnections } from './oauth-connections.mjs';
import { beaconOwner, beaconLease } from './beacon-config.mjs';

export async function beaconBootIdentity(fetchImpl=fetch) {
  const read=async field=>{
    const r=await fetchImpl('http://metadata.google.internal/computeMetadata/v1/instance/attributes/portabase-beacon-'+field,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000),redirect:'error'});
    if(r.status===404)return null;if(!r.ok)throw Error('beacon_metadata_unavailable');return (await r.text()).trim();
  };
  const owner=await read('owner');
  if(!owner)return null;
  return {owner:beaconOwner(owner),leaseId:beaconLease(await read('lease'))};
}
export async function runBeaconWorker({owner,leaseId,oauthConfig,storage,crypt=beaconCrypto(),connections=oauthConnections(oauthConfig),now=Date.now}={}) {
  beaconOwner(owner);beaconLease(leaseId);
  const store=storage||beaconStorage({token:crypt.token});
  const before=await store.get('leases',owner);
  if(before?.data?.id!==leaseId||before.data.state!=='running'||before.data.deadlineAt<=now())throw Error('beacon_lease_invalid');
  let receipt;
  try { receipt=await destinationBeacons({crypt,storage:store,now}).run(owner,leaseId,connections); }
  catch(e){receipt={kind:'beacon',requestId:leaseId,status:'failed',durationMs:0,outboundBytes:null,billableBytes:0,
    startedAt:new Date(now()).toISOString(),finishedAt:new Date(now()).toISOString(),
    errorCode:['beacon_disabled','beacon_not_due','beacon_already_claimed','beacon_settings_changed'].includes(e.message)?e.message:'beacon_execution_failed'};}
  for(let attempt=0;attempt<5;attempt++){
    const current=await store.get('leases',owner);
    if(current?.data?.id!==leaseId||current.data.state!=='running')throw Error('beacon_lease_changed');
    if(current.data.receipt)return current.data.receipt;
    if((await store.put('leases',owner,{...current.data,receipt},current.generation)).modified)return receipt;
  }
  throw Error('beacon_receipt_contention');
}
