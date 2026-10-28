const CONTROLLER='https://portabase-confidential-controller-26ulj3ikia-uc.a.run.app';
/** Forward only the current caller's credential to the fixed controller; never customer-selected URLs. */
export async function confidentialRuntimeView(event,{fetchImpl=fetch,windowStart}={}) {
  const authorization=Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()==='authorization')?.[1];
  if(!authorization)return {available:false,status:'sign_in_required'};
  const response=await fetchImpl(CONTROLLER+'/usage',{method:'POST',headers:{Authorization:authorization,'content-type':'application/json'},
    body:JSON.stringify(windowStart?{windowStart}:{}),redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {available:false,status:'runner_usage_unavailable'};
  const data=await response.json();
  if(!['measured','no_samples'].includes(data.status))return {available:false,status:'runner_usage_unavailable'};
  for(const key of ['runnerRuntimeMs','beaconRuntimeMs'])if(data[key]!==null&&(!Number.isFinite(data[key])||data[key]<0))return {available:false,status:'runner_usage_invalid'};
  return {available:true,status:data.status,runnerRuntimeMs:data.runnerRuntimeMs,beaconRuntimeMs:data.beaconRuntimeMs,
    windowStart:data.windowStart,windowEnd:data.windowEnd,lastSampleAt:data.lastSampleAt,
    sampled:true,reportingDelaySeconds:300};
}


export async function confidentialBeaconView(event,{fetchImpl=fetch}={}) {
  const authorization=Object.entries(event.headers||{}).find(([key])=>key.toLowerCase()==='authorization')?.[1];
  if(!authorization)return {available:false,status:'sign_in_required'};
  const response=await fetchImpl(CONTROLLER+'/beacon/status',{method:'POST',headers:{Authorization:authorization,'content-type':'application/json'},
    body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)return {available:false,status:'beacon_status_unavailable'};
  const data=await response.json();
  if(data.intervalHours!==72||data.windowDays!==30||data.chargedBytes!==0||!['jobsSucceeded','jobsFailed','jobRuntimeMs'].every(k=>Number.isFinite(data[k])&&data[k]>=0))return {available:false,status:'beacon_status_invalid'};
  const last=data.lastBeacon;
  return {available:true,intervalHours:72,windowDays:30,jobsSucceeded:data.jobsSucceeded,jobsFailed:data.jobsFailed,
    jobRuntimeMs:data.jobRuntimeMs,outboundBytes:null,chargedBytes:0,runnerState:String(data.runnerState||'unknown'),
    lastBeacon:last?{status:last.status,startedAt:last.startedAt,finishedAt:last.finishedAt,durationMs:last.durationMs,errorCode:last.errorCode||null}:null,
    guarantee:'activity_probe_only'};
}
