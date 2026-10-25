const ROOT = 'http://metadata.google.internal/computeMetadata/v1';
async function metadata(path) {
  const r=await fetch(ROOT+path,{headers:{'Metadata-Flavor':'Google'},signal:AbortSignal.timeout(5000)});
  if(!r.ok) throw new Error('workload_identity_unavailable');
  return r;
}
export async function googleAccessToken() {
  const body=await (await metadata('/instance/service-accounts/default/token')).json();
  if(!body.access_token) throw new Error('workload_identity_unavailable');
  return body.access_token;
}
export async function loadWorkloadConfig() {
  const project=(await (await metadata('/project/project-id')).text()).trim();
  if(project!=='portabase-dev') throw new Error('wrong_product_project');
  const token=await googleAccessToken();
  const response=await fetch('https://secretmanager.googleapis.com/v1/projects/portabase-dev/secrets/portabase-confidential-oauth/versions/latest:access',{
    headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error('oauth_configuration_unavailable');
  const envelope=await response.json();
  const config=JSON.parse(Buffer.from(envelope.payload.data,'base64').toString('utf8'));
  if(!config.clientId || !config.clientSecret) throw new Error('oauth_configuration_invalid');
  return config;
}
export function admissionEndpoint(value=process.env.PORTABASE_ADMISSION_ENDPOINT) {
  const endpoint=value||'https://portabase.dev/api/cloud/confidential-admission';
  if(endpoint!=='https://portabase.dev/api/cloud/confidential-admission' &&
    !/^https:\/\/[a-f0-9]{24}--portabase-dev\.netlify\.app\/\.netlify\/functions\/cloud-confidential-admission$/.test(endpoint)) {
    throw new Error('unapproved_admission_endpoint');
  }
  return endpoint;
}
export async function admitJob({authorization,operation,requestId}) {
  if(!/^[a-f0-9-]{36}$/i.test(requestId||'')) throw new Error('invalid_request_id');
  const response=await fetch(admissionEndpoint(),{
    method:'POST',headers:{Authorization:authorization,'content-type':'application/json','x-portabase-cloud-version':'supabase'},
    body:JSON.stringify({operation,requestId}),redirect:'error',signal:AbortSignal.timeout(15000)});
  const result=await response.json();
  if(!response.ok) throw new Error(response.status===429?'daily_limit_reached':'quota_service_unavailable');
  if(!Number.isSafeInteger(result.maxBytes) || result.maxBytes<1) throw new Error('invalid_job_limit');
  return result;
}
