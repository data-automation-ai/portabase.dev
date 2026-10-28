// Narrow release of a committed dashboard and its OAuth integration. Preserve
// the published homepage, AWS page, every unrelated asset and backend function.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {builtinModules} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'vite';
import {rolldown} from 'rolldown';
import {operatorConfig,SITE_ID} from '../cloud/confidential/operator-config.mjs';
import {operatorGoogle} from '../cloud/confidential/operator-google.mjs';
import {getStore} from '@netlify/blobs';
import {sealOAuthConfig,openOAuthConfig} from '../netlify/shared/hosted-oauth-config.mjs';
const action=process.argv[2]||'prepare',stage=resolve('.portabase/graphical-release');
const hash=(value,kind='sha1')=>createHash(kind).update(value).digest('hex');
const op=await operatorConfig();await mkdir(stage,{recursive:true});
const evidence=join(stage,'release.json');
if(action==='prepare'){
  const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const tracked=execFileSync('git',['status','--porcelain','--untracked-files=no'],{encoding:'utf8'}).trim();
  if(tracked)throw Error('commit_reviewed_changes_before_release');
  const source=join(stage,'source-'+sourceCommit),archive=join(stage,'source-'+sourceCommit+'.zip');
  await mkdir(source,{recursive:true});
  execFileSync('git',['archive','--format=zip','--output',archive,sourceCommit]);
  execFileSync('python',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,source]);
  for(const key of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_GOOGLE_OAUTH_CLIENT_ID'])if(op.value(key))process.env[key]=op.value(key);
  const output=join(stage,'build-'+sourceCommit);
  await build({root:source,configFile:false,base:'/graphical-assets/',build:{outDir:output,emptyOutDir:false}});
  const bundle=await rolldown({input:join(source,'netlify/functions/cloud-oauth.mjs'),platform:'node',
    external:[...builtinModules,...builtinModules.map(n=>'node:'+n)]});
  const functionFile=join(stage,'cloud-oauth.js');
  await bundle.write({file:functionFile,format:'cjs',codeSplitting:false});await bundle.close();
  execFileSync('python',['-c','import sys,zipfile; z=zipfile.ZipFile(sys.argv[2],"w",zipfile.ZIP_DEFLATED); z.write(sys.argv[1],"cloud-oauth.js"); z.close()',functionFile,join(stage,'cloud-oauth.zip')]);
  const base=op.site.published_deploy.id,deploy=await op.netlify('/deploys/'+base),entries=await op.netlify('/deploys/'+base+'/files');
  if(deploy.edge_functions_present||entries.some(e=>e.path.includes('edge-functions')))throw Error('edge_review_required');
  const files=Object.fromEntries(entries.map(e=>[e.path,e.sha]));
  const prior=JSON.parse(await readFile(evidence,'utf8'));
  const expectedRedirect=prior.publishedAt&&prior.draft===base&&prior.files['/index.html']===files['/index.html']
    ? prior.files['/_redirects'] : 'ce7caca07b1fa78422967d089efa83f965e24dcc';
  if(files['/_redirects']!==expectedRedirect)throw Error('baseline_routes_changed_review_required');
  const uploads=[];
  async function add(path,body){const sha=hash(body);files[path]=sha;uploads.push({path,sha});await writeFile(join(stage,sha),body);}
  let html=await readFile(join(output,'index.html'),'utf8');
  html=html.replace('<head>','<head><meta name="portabase-recovery-revision" content="'+sourceCommit+'">');
  await add('/graphical-dashboard.html',html);
  for(const name of await readdir(join(output,'assets')))await add('/graphical-assets/assets/'+name,await readFile(join(output,'assets',name)));
  const redirects='/dashboard /graphical-dashboard.html 200!\n/dashboard/* /graphical-dashboard.html 200!\n/app /graphical-dashboard.html 200!\n/app/* /graphical-dashboard.html 200!\n/confidential/callback /.netlify/functions/cloud-oauth 200!\n# AWS assessment is served from its static directory; other routes remain in netlify.toml.\n';
  await add('/_redirects',redirects);
  const functions=Object.fromEntries(deploy.available_functions.map(f=>[f.n,f.d]));
  const functions_config=Object.fromEntries(deploy.available_functions.map(f=>[f.n,{runtime:f.r,display_name:f.dn,generator:f.g}]));
  const zip=await readFile(join(stage,'cloud-oauth.zip'));functions['cloud-oauth']=hash(zip,'sha256');
  functions_config['cloud-oauth']={runtime:'nodejs24.x'};
  const saved={base,sourceCommit,files,uploads,functions,functions_config,function_schedules:deploy.function_schedules||[],
    preservedFiles:entries.length,preservedFunctions:deploy.available_functions.length,originalIndex:files['/index.html'],
    originalFunctions:Object.fromEntries(deploy.available_functions.map(f=>[f.n,f.d])),createdAt:new Date().toISOString()};
  await writeFile(evidence,JSON.stringify(saved,null,2));
  console.log(JSON.stringify({prepared:sourceCommit,base,changed:uploads.map(f=>f.path),function:'cloud-oauth',preservedFunctions:saved.preservedFunctions}));
}else if(action==='configure'){
  // Reuse the already registered application and redirect, never print its secret.
  const google=await operatorGoogle();
  const secret=await google('/v1/projects/portabase-dev/secrets/portabase-confidential-oauth/versions/latest:access');
  const app=JSON.parse(Buffer.from(secret.payload.data,'base64').toString());
  if(!/^[a-f0-9-]{36}$/i.test(app.clientId||'')||typeof app.clientSecret!=='string'||app.clientSecret.length<16||app.redirectUri!=='https://portabase.dev/confidential/callback')throw Error('registered_oauth_identity_mismatch');
  const values={SUPABASE_OAUTH_CLIENT_ID:app.clientId,SUPABASE_OAUTH_CLIENT_SECRET:app.clientSecret,SUPABASE_OAUTH_REDIRECT_URI:app.redirectUri};
  const token=op.value('NETLIFY_BLOBS_TOKEN');
  const store=getStore({name:'portabase-hosted-oauth',siteID:SITE_ID,token,consistency:'strong'});
  await store.setJSON('config',sealOAuthConfig(app,token));
  const restored=openOAuthConfig(await store.get('config',{type:'json'}),token);
  if(restored.clientId!==app.clientId||restored.clientSecret!==app.clientSecret)throw Error('private_configuration_verification_failed');
  for(const [key,value] of Object.entries(values)){
    if(!op.rows.some(r=>r.key===key))continue;
    if(op.value(key)!==value)throw Error('existing_oauth_configuration_requires_review');
    await op.netlify('/accounts/'+op.site.account_id+'/env/'+key+'?site_id='+SITE_ID,{method:'DELETE'});
  }
  console.log(JSON.stringify({privateConfigurationVerified:true,unrelatedFunctionEnvironmentPreserved:true,secretValuesPrinted:false}));
}else{
  const saved=JSON.parse(await readFile(evidence,'utf8'));
  if(action==='draft'){
    if(op.site.published_deploy.id!==saved.base)throw Error('production_changed');
    const draft=await op.netlify('/sites/'+SITE_ID+'/deploys',{method:'POST',body:JSON.stringify({draft:true,async:true,title:'Restore graphical recovery dashboard + integrated picker — '+saved.sourceCommit.slice(0,7),files:saved.files,functions:saved.functions,functions_config:saved.functions_config,function_schedules:saved.function_schedules})});
    saved.draft=draft.id;saved.url=draft.deploy_ssl_url;await writeFile(evidence,JSON.stringify(saved,null,2));
    console.log(JSON.stringify({draft:draft.id,url:draft.deploy_ssl_url}));
  }else{
    const draft=await op.netlify('/deploys/'+saved.draft);
    if(action==='upload'){
      if(draft.required_edge_functions?.length)throw Error('edge_reuse_failed');
      if(draft.required_functions?.some(digest=>digest!==saved.functions['cloud-oauth']))throw Error('unrelated_function_requested');
      for(const sha of draft.required||[]){const file=saved.uploads.find(f=>f.sha===sha);if(!file)throw Error('unrelated_asset_requested');
        await op.netlify('/deploys/'+draft.id+'/files'+file.path,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:await readFile(join(stage,sha))});}
      if(draft.required_functions?.length)await op.netlify('/deploys/'+draft.id+'/functions/cloud-oauth?runtime=nodejs24.x',{method:'PUT',headers:{'content-type':'application/zip'},body:await readFile(join(stage,'cloud-oauth.zip'))});
      console.log(JSON.stringify({uploadedAssets:draft.required?.length||0,uploadedFunctions:draft.required_functions?.length||0}));
    }else if(action==='publish'){
      if(draft.state!=='ready'||op.site.published_deploy.id!==saved.base)throw Error('release_state_changed');
      const next=await op.netlify('/deploys/'+draft.id+'/functions');
      if(next.functions.length!==saved.preservedFunctions||next.functions.some(f=>f.n!=='cloud-oauth'&&saved.originalFunctions[f.n]!==f.d))throw Error('unrelated_functions_changed');
      const entries=await op.netlify('/deploys/'+draft.id+'/files');
      if(entries.find(f=>f.path==='/index.html')?.sha!==saved.originalIndex)throw Error('homepage_changed');
      await op.netlify('/sites/'+SITE_ID+'/deploys/'+draft.id+'/restore',{method:'POST'});
      saved.publishedAt=new Date().toISOString();await writeFile(evidence,JSON.stringify(saved,null,2));
      console.log(JSON.stringify({published:draft.id,source:saved.sourceCommit,rollback:saved.base,homepagePreserved:true}));
    }else console.log(JSON.stringify({id:draft.id,state:draft.state,url:draft.deploy_ssl_url}));
  }
}
