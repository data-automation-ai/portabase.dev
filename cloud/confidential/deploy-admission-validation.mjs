// Isolated draft only. This script cannot publish or replace production.
import {readFile,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {operatorConfig,SITE_ID} from './operator-config.mjs';
async function main(){
 const root=resolve('.worktrees/confidential-app-20261024'),git=promisify(execFile);
 if((await git('git',['-C',root,'status','--porcelain'])).stdout.trim())throw new Error('release_source_not_clean');
 const commit=(await git('git',['-C',root,'rev-parse','HEAD'])).stdout.trim();
 const cli=join(process.env.APPDATA,'npm/node_modules/netlify-cli');
 const {zipFunction}=await import(pathToFileURL(join(cli,'node_modules/@netlify/zip-it-and-ship-it/dist/main.js')));
 const stage=await mkdtemp(join(tmpdir(),'portabase-admission-v2-'));
 const bundle=await zipFunction(join(root,'netlify/functions/cloud-confidential-admission.mjs'),stage,
  {basePath:root,repositoryRoot:root,config:{'*':{nodeBundler:'esbuild',nodeVersion:'24'}}});
 if(bundle.runtimeAPIVersion!==2)throw new Error('native_function_runtime_required');
 const zip=await readFile(bundle.path),digest=createHash('sha256').update(zip).digest('hex');
 const html=Buffer.from('<!doctype html><title>Portabase validation</title><p>Isolated admission test. Not the production website.</p>');
 const sha=createHash('sha1').update(html).digest('hex'),op=await operatorConfig();
 const previous=op.site.published_deploy.id;
 const draft=await op.netlify(`/sites/${SITE_ID}/deploys?title=Native%20confidential%20admission%20validation`,{method:'POST',body:JSON.stringify({
  draft:true,branch:'main',files:{'index.html':sha},functions:{'cloud-confidential-admission':digest},
  functions_config:{'cloud-confidential-admission':{build_data:{runtimeAPIVersion:2,bootstrapVersion:bundle.bootstrapVersion},memory:1024}}})});
 const record={id:draft.id,url:`https://${draft.id}--portabase-dev.netlify.app`,sourceCommit:commit,functionDigest:digest,
  runtimeAPIVersion:2,bootstrapVersion:bundle.bootstrapVersion,invocationMode:bundle.invocationMode,stage,originalProduction:previous,productionPublished:false,createdAt:new Date().toISOString()};
 await writeFile(new URL('./evidence/admission-isolated-native-draft.json',import.meta.url),JSON.stringify(record,null,2)+'\n');
 if(draft.required?.includes(sha))await op.netlify(`/deploys/${draft.id}/files/index.html`,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:html});
 if(draft.required_functions?.includes(digest))await op.netlify(`/deploys/${draft.id}/functions/cloud-confidential-admission?runtime=nodejs24.x&invocation_mode=${encodeURIComponent(bundle.invocationMode)}`,{method:'PUT',headers:{'content-type':'application/zip'},body:zip});
 console.log(JSON.stringify(record));
}
main().catch(e=>{console.error(/^[a-z0-9_]{3,100}$/.test(e.message)?e.message:'isolated_deploy_failed');process.exitCode=1;});
