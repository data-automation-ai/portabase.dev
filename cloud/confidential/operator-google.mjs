// Operator-only: excluded from every runtime image and browser bundle.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function operatorGoogle() {
  let token,tokenCheckedAt=0;
  async function refreshToken() {
    let stdout;
    try {
      ({stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',
        'gcloud auth print-access-token --account=rfiddomains@gmail.com --quiet'],{windowsHide:true,timeout:20000}));
    } catch { throw new Error('google_operator_login_required'); }
    const next=stdout.trim();if(!next || /\s/.test(next))throw new Error('google_operator_login_required');
    token=next;tokenCheckedAt=Date.now();
  }
  await refreshToken();
  return async(path,{method='GET',body}={})=>{
    if(!path.startsWith('/v1/projects/portabase-dev/secrets'))throw new Error('wrong_operator_project');
    if(Date.now()-tokenCheckedAt>=45*60_000)await refreshToken();
    const payload=body?JSON.stringify(body):undefined;
    const send=()=>fetch('https://secretmanager.googleapis.com'+path,{method,
      headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},
      ...(payload?{body:payload}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    let response=await send();
    if(response.status===401){await refreshToken();response=await send();}
    if(response.status===404)return null;
    if(!response.ok)throw new Error(`google_secret_http_${response.status}`);
    return response.json();
  };
}
