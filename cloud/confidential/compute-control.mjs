import {googleAccessToken} from './cloud-config.mjs';
import {BEACON_MAX_SECONDS,beaconOwner,beaconLease} from './beacon-config.mjs';
const PROJECT='portabase-dev',ZONE='us-central1-a',REGION='us-central1';
const MAX_RUN_SECONDS=4*60*60; // Two bounded 90-minute jobs plus setup and verification.
const API=`https://compute.googleapis.com/compute/v1/projects/${PROJECT}`;
export const runnerName=owner=>{
  if(!/^[a-f0-9]{64}$/.test(owner||''))throw new Error('invalid_customer');
  return `pbconf-${owner.slice(0,40)}`;
};
export const beaconRunnerName=owner=>`pbbeacon-${beaconOwner(owner).slice(0,40)}`;
export function beaconInstanceConfiguration(owner,image,leaseId) {
  beaconLease(leaseId);
  const config=instanceConfiguration(owner,image);
  config.name=beaconRunnerName(owner);
  config.labels.purpose='destination-beacon';
  config.scheduling.maxRunDuration.seconds=String(BEACON_MAX_SECONDS);
  config.metadata.items.push({key:'portabase-beacon-owner',value:owner},{key:'portabase-beacon-lease',value:leaseId});
  return config;
}
export function instanceConfiguration(owner,image) {
  if(!/^us-central1-docker\.pkg\.dev\/portabase-dev\/portabase-confidential\/application@sha256:[a-f0-9]{64}$/.test(image||''))throw new Error('immutable_application_image_required');
  return {name:runnerName(owner),machineType:`zones/${ZONE}/machineTypes/c3-standard-4`,
    labels:{product:'portabase',purpose:'confidential-recovery',customer:owner.slice(0,40)},
    confidentialInstanceConfig:{confidentialInstanceType:'TDX'},
    shieldedInstanceConfig:{enableSecureBoot:true,enableVtpm:true,enableIntegrityMonitoring:true},
    scheduling:{onHostMaintenance:'TERMINATE',automaticRestart:false,provisioningModel:'STANDARD',
      maxRunDuration:{seconds:String(MAX_RUN_SECONDS)},instanceTerminationAction:'DELETE'},
    disks:[{boot:true,autoDelete:true,type:'PERSISTENT',interface:'NVME',initializeParams:{diskSizeGb:'160',
      diskType:`zones/${ZONE}/diskTypes/pd-balanced`,sourceImage:'projects/confidential-space-images/global/images/confidential-space-261000'}}],
    networkInterfaces:[{network:`projects/${PROJECT}/global/networks/portabase-confidential`,
      subnetwork:`projects/${PROJECT}/regions/${REGION}/subnetworks/portabase-confidential`,
      accessConfigs:[{type:'ONE_TO_ONE_NAT',name:'Outbound internet'}]}],
    tags:{items:['portabase-confidential-runner']},
    serviceAccounts:[{email:'pb-conf-runtime@portabase-dev.iam.gserviceaccount.com',scopes:['https://www.googleapis.com/auth/cloud-platform']}],
    metadata:{items:[{key:'tee-image-reference',value:image},{key:'tee-restart-policy',value:'Never'},
      {key:'tee-container-log-redirect',value:'false'},{key:'serial-port-enable',value:'false'}]}};
}
export function computeControl({image,token=googleAccessToken,fetchImpl=fetch}={}) {
  async function request(path,{method='GET',body}={}) {
    const response=await fetchImpl(API+path,{method,headers:{Authorization:`Bearer ${await token()}`,'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(20000)});
    if(response.status===404)return null;
    if(response.status===409)return {pending:true};
    if(!response.ok)throw new Error('runner_provider_unavailable');
    return response.json();
  }
  function own(instance,owner) {
    if(!instance)return null;
    if(instance.name!==runnerName(owner)||instance.labels?.customer!==owner.slice(0,40)
      ||instance.confidentialInstanceConfig?.confidentialInstanceType!=='TDX')throw new Error('runner_identity_mismatch');
    const address=instance.networkInterfaces?.[0]?.networkIP;
    if(address && !/^10\.98\.0\.(?:[0-9]{1,3})$/.test(address))throw new Error('invalid_runner_address');
    return {name:instance.name,id:instance.id,status:instance.status,address,
      createdAt:instance.creationTimestamp,expiresAt:new Date(Date.parse(instance.creationTimestamp)+MAX_RUN_SECONDS*1000).toISOString()};
  }
  return {
    async get(owner){return own(await request(`/zones/${ZONE}/instances/${runnerName(owner)}`),owner);},
    async create(owner){return request(`/zones/${ZONE}/instances`,{method:'POST',body:instanceConfiguration(owner,image)});},
    async remove(owner){const instance=await this.get(owner);if(instance)await request(`/zones/${ZONE}/instances/${runnerName(owner)}`,{method:'DELETE'});},
    async getBeacon(owner){
      const instance=await request(`/zones/${ZONE}/instances/${beaconRunnerName(owner)}`);
      if(!instance)return null;
      if(instance.name!==beaconRunnerName(owner)||instance.labels?.customer!==owner.slice(0,40)||instance.labels?.purpose!=='destination-beacon'
        ||instance.confidentialInstanceConfig?.confidentialInstanceType!=='TDX')throw Error('beacon_runner_identity_mismatch');
      const metadata=Object.fromEntries((instance.metadata?.items||[]).map(x=>[x.key,x.value]));
      if(metadata['portabase-beacon-owner']!==owner)throw Error('beacon_runner_identity_mismatch');
      return {id:instance.id,createdAt:instance.creationTimestamp,status:instance.status,leaseId:beaconLease(metadata['portabase-beacon-lease'])};
    },
    async createBeacon(owner,leaseId){return request(`/zones/${ZONE}/instances`,{method:'POST',body:beaconInstanceConfiguration(owner,image,leaseId)});},
    async removeBeacon(owner,leaseId){
      const instance=await this.getBeacon(owner);
      if(instance&&instance.leaseId!==leaseId)throw Error('beacon_runner_lease_mismatch');
      if(instance)await request(`/zones/${ZONE}/instances/${beaconRunnerName(owner)}`,{method:'DELETE'});
    },
  };
}
