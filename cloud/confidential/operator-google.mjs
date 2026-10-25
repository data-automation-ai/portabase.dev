// Operator-only: excluded from every runtime image and browser bundle.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export async function operatorGoogle() {
  const {stdout}=await exec('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    'gcloud auth print-access-token --account=rfiddomains@gmail.com --quiet'],{windowsHide:true,timeout:20000});
  const token=stdout.trim();if(!token || /\s/.test(token))throw new Error('google_operator_login_required');
  return async(path,{method='GET',body}={})=>{
    if(!path.startsWith('/v1/projects/portabase-dev/secrets'))throw new Error('wrong_operator_project');
    const response=await fetch('https://secretmanager.googleapis.com'+path,{method,
      headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15000)});
    if(response.status===404)return null;
    if(!response.ok)throw new Error(`google_secret_http_${response.status}`);
    return response.json();
  };
}
