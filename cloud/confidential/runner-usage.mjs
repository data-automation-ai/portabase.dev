import {googleAccessToken} from './cloud-config.mjs';
import {runnerName,beaconRunnerName} from './compute-control.mjs';
// Provider DELTA uptime survives VM deletion and controller restarts. It is
// sampled usage, never inferred from backup job durations or quota admissions.
export function runnerUsage({token=googleAccessToken,fetchImpl=fetch,now=Date.now}={}) {
  return async (owner,{windowStart}={})=>{
    const end=now(),start=windowStart===undefined?end-30*86400000:Date.parse(windowStart),names=[runnerName(owner),beaconRunnerName(owner)];
    if(!Number.isFinite(start)||start>end||start<end-30*86400000)throw Error('invalid_usage_window');
    const filter=`resource.type="gce_instance" AND resource.labels.project_id="portabase-dev" AND resource.labels.zone="us-central1-a" AND metric.type="compute.googleapis.com/instance/uptime" AND (metric.labels.instance_name="${names[0]}" OR metric.labels.instance_name="${names[1]}")`;
    let cursor,seconds=0,beaconSeconds=0,lastSample=null,samples=0,boundarySamplesExcluded=0;
    const seen=new Set();
    for(let page=0;page<30;page++){
      const query=new URLSearchParams({filter,'interval.startTime':new Date(start).toISOString(),'interval.endTime':new Date(end).toISOString(),view:'FULL',pageSize:'10000',...(cursor?{pageToken:cursor}:{})});
      const response=await fetchImpl('https://monitoring.googleapis.com/v3/projects/portabase-dev/timeSeries?'+query,{headers:{Authorization:`Bearer ${await token()}`},redirect:'error',signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw Error('runner_usage_unavailable');
      const data=await response.json();
      if(data.timeSeries!==undefined&&!Array.isArray(data.timeSeries))throw Error('runner_usage_invalid');
      for(const series of data.timeSeries||[]){
        const name=series.metric?.labels?.instance_name;
        if(!names.includes(name)||series.metric?.type!=='compute.googleapis.com/instance/uptime'||series.resource?.type!=='gce_instance'||series.resource?.labels?.project_id!=='portabase-dev'||series.resource?.labels?.zone!=='us-central1-a'
          ||!/^\d+$/.test(series.resource?.labels?.instance_id||'')||series.metricKind!=='DELTA')throw Error('runner_usage_identity_mismatch');
        for(const point of series.points||[]){
          const a=Date.parse(point.interval?.startTime),b=Date.parse(point.interval?.endTime),value=Number(point.value?.doubleValue);
          if(!Number.isFinite(a)||!Number.isFinite(b)||b<=a||!Number.isFinite(value)||value<0||value>(b-a)/1000+1)throw Error('runner_usage_invalid');
          const key=series.resource.labels.instance_id+':'+a+':'+b;
          if(seen.has(key))continue;seen.add(key);
          if(a<start||b>end){boundarySamplesExcluded++;continue;}
          seconds+=value;if(name===names[1])beaconSeconds+=value;samples++;lastSample=Math.max(lastSample||0,b);
        }
      }
      cursor=data.nextPageToken;
      if(!cursor)return {source:'google_compute_uptime',windowStart:new Date(start).toISOString(),windowEnd:new Date(end).toISOString(),
        runnerRuntimeMs:Math.round(seconds*1000),runnerHours:seconds/3600,beaconRuntimeMs:Math.round(beaconSeconds*1000),
        lastSampleAt:lastSample?new Date(lastSample).toISOString():null,samples,boundarySamplesExcluded,
        sampled:true,reportingDelaySeconds:300,status:samples?'measured':'no_samples'};
    }
    throw Error('runner_usage_pagination_limit');
  };
}
