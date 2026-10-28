// Reviewable release tooling. No action mutates site environment or billing.
// plan is local/read-only; prepare archives a clean commit; draft/upload/publish are explicit steps.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {resolve,join,dirname,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {build} from 'vite';
import {operatorConfig,SITE_ID} from '../cloud/confidential/operator-config.mjs';
import {verifyNativePackage} from './lib/verify-netlify-package.mjs';
const root=resolve('.'),stage=resolve('.portabase/enclave-policy-release'),evidence=join(stage,'release.json');
const action=process.argv[2]||'plan',arg=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
// Parent verified the served graphical-dashboard revision on 2026-10-28.
const baseline=arg('base')||'b3c03c7ea1de8b9ea6516f2ecd0673cc3f5be181';
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const hash=(value,kind='sha1')=>createHash(kind).update(value).digest('hex');
const normalize=p=>p.replaceAll('\\','/');
async function impactedFunctions(){
 const changed=new Set([...git('diff','--name-only',baseline,'--').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean));
 const cache=new Map();
 async function dependencies(file,seen=new Set()){
  if(seen.has(file))return seen;seen.add(file);
  let source=cache.get(file);if(source===undefined){source=await readFile(join(root,file),'utf8');cache.set(file,source);}
  for(const match of source.matchAll(/(?:from\s*|import\s*\()\s*['"]([^'"]+)['"]/g)){
   if(!match[1].startsWith('.'))continue;
   const target=normalize(relative(root,resolve(root,dirname(file),match[1])));
   if(!/\.(?:mjs|cjs|js|json)$/.test(target))continue;
   await dependencies(target,seen);
  }
  return seen;
 }
 const results=[];
 for(const name of (await readdir('netlify/functions')).filter(x=>/\.(mjs|js|cjs)$/.test(x)).sort()){
  const file='netlify/functions/'+name,deps=await dependencies(file),reasons=[...deps].filter(p=>changed.has(p));
  if(reasons.length)results.push({name:name.replace(/\.(mjs|js|cjs)$/,''),file,reasons});
 }
 return results;
}
await mkdir(stage,{recursive:true});
if(action==='plan'){
 const affected=await impactedFunctions();console.log(JSON.stringify({base:baseline,sourceCommit:git('rev-parse','HEAD'),affectedFunctions:affected,reviewArgument:'--functions='+affected.map(x=>x.name).join(',')},null,2));
}else if(action==='prepare'){
 if(git('status','--porcelain','--untracked-files=no')||git('ls-files','--others','--exclude-standard','--','netlify','src','cloud','utility','public','scripts'))throw Error('commit_reviewed_changes_before_release');
 const sourceCommit=git('rev-parse','HEAD'),affected=await impactedFunctions();
 const approved=(arg('functions')||'').split(',').filter(Boolean).sort(),expected=affected.map(x=>x.name).sort();
 if(JSON.stringify(approved)!==JSON.stringify(expected))throw Error('review_complete_function_set_from_plan');
 const op=await operatorConfig(),base=op.site.published_deploy.id;
 const deploy=await op.netlify('/deploys/'+base),entries=await op.netlify('/deploys/'+base+'/files');
 const published=await fetch(`https://${base}--portabase-dev.netlify.app/graphical-dashboard.html`,{redirect:'error'});
 if(!published.ok||(await published.text()).match(/name="portabase-recovery-revision" content="([^"]+)"/)?.[1]!==baseline)throw Error('served_source_baseline_changed_review_required');
 if(deploy.edge_functions_present)throw Error('edge_review_required');
 const source=join(stage,'source-'+sourceCommit),archive=source+'.zip';await mkdir(source,{recursive:true});
 execFileSync('git',['archive','--format=zip','--output',archive,sourceCommit],{cwd:root});
 execFileSync('python',['-c','import sys,zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',archive,source]);
 for(const name of ['VITE_SUPABASE_URL','VITE_SUPABASE_ANON_KEY','VITE_GOOGLE_OAUTH_CLIENT_ID'])if(op.value(name))process.env[name]=op.value(name);
 const output=join(stage,'build-'+sourceCommit),assetBase='/enclave-assets/'+sourceCommit.slice(0,12)+'/';
 await build({root:source,configFile:false,base:assetBase,build:{outDir:output,emptyOutDir:false}});
 const files=Object.fromEntries(entries.map(x=>[x.path,x.sha])),uploads=[];
 async function add(path,body){const sha=hash(body);files[path]=sha;uploads.push({path,sha});await writeFile(join(stage,sha),body);}
 const html=(await readFile(join(output,'index.html'),'utf8')).replace('<head>','<head><meta name="portabase-recovery-revision" content="'+sourceCommit+'">');
 await add('/index.html',html);await add('/graphical-dashboard.html',html);
 for(const name of await readdir(join(output,'assets')))await add(assetBase+'assets/'+name,await readFile(join(output,'assets',name)));
 for(const file of ['images/portabase-secure-enclave-flow.png','gcp-logo.png','intel-tdx-logo.png','data/cases-snapshot.json'])await add('/'+file,await readFile(join(source,'public',file)));
 const originalRedirect=entries.find(x=>x.path==='/_redirects');if(!originalRedirect)throw Error('published_routes_missing');
 let routeBytes;
 // Netlify may hide _redirects from HTTP. Prefer preserved, hash-verified prior release artifacts.
 for(const folder of [stage,resolve('.portabase/graphical-release'),resolve('.portabase/picker-rescue')]){
  try{const candidate=await readFile(join(folder,originalRedirect.sha));if(hash(candidate)===originalRedirect.sha){routeBytes=candidate;break;}}catch{}
 }
 if(!routeBytes){const response=await fetch(`https://${base}--portabase-dev.netlify.app/_redirects`,{redirect:'error'});
  if(!response.ok)throw Error('published_routes_unreadable');routeBytes=Buffer.from(await response.arrayBuffer());}
 if(hash(routeBytes)!==originalRedirect.sha)throw Error('published_routes_hash_mismatch');
 const toml=await readFile(join(source,'netlify.toml'),'utf8'),prefix=[];
 for(const block of toml.split('[[redirects]]').slice(1)){
  const from=block.match(/^\s*from\s*=\s*"([^"]+)"/m)?.[1],to=block.match(/^\s*to\s*=\s*"([^"]+)"/m)?.[1],status=block.match(/^\s*status\s*=\s*(\d+)/m)?.[1];
  if(from&&to?.startsWith('/.netlify/functions/')&&status)prefix.push(`${from} ${to} ${status}!`);
 }
 prefix.push('/security /index.html 200!','/trust /index.html 200!','/legal /index.html 200!','/cases/manage /index.html 200!','/cases/submit /index.html 200!');
 if(files['/aws/index.html'])prefix.unshift('/aws /aws/index.html 200','/aws/ /aws/index.html 200');
 // API archive releases do not carry netlify.toml routing. Preserve prior routes,
 // then supply an unforced SPA fallback so existing AWS/static files still win.
 await add('/_redirects',prefix.join('\n')+'\n'+routeBytes.toString()+'\n/* /index.html 200\n');
 const functions=Object.fromEntries(deploy.available_functions.map(f=>[f.n,f.d]));
 const functions_config=Object.fromEntries(deploy.available_functions.map(f=>[f.n,{runtime:f.r,display_name:f.dn,generator:f.g,build_data:f.bd||undefined,memory:f.m,region:f.rg}]));
 const cli=join(process.env.APPDATA,'npm/node_modules/netlify-cli');
 const {zipFunction}=await import(pathToFileURL(join(cli,'node_modules/@netlify/zip-it-and-ship-it/dist/main.js')));
 const functionArtifacts=[];const schedules=[...(deploy.function_schedules||[])];
 // Native v2 forces NFT tracing, which excludes dependencies above repositoryRoot.
 // This worktree resolves installed packages in the main checkout's node_modules.
 // Include that traced boundary; archive source still comes only from sourceCommit.
 const dependencyRoot=resolve(git('rev-parse','--git-common-dir'),'..');
 for(const row of affected){
  const bundle=await zipFunction(join(source,row.file),stage,{basePath:source,repositoryRoot:dependencyRoot,config:{'*':{nodeBundler:'esbuild',nodeVersion:'24'}}});
  if(['cloud-confidential-admission','cloud-confidential-usage','cloud-confidential-session','cloud-dashboard','cases','cases-submit','cases-manage'].includes(row.name)&&bundle.runtimeAPIVersion!==2)throw Error('native_function_runtime_required');
  await verifyNativePackage({...bundle,name:row.name},join(stage,'package-check-'+sourceCommit));
  const bytes=await readFile(bundle.path),digest=hash(bytes,'sha256');functions[row.name]=digest;
  functions_config[row.name]={runtime:'nodejs24.x',build_data:bundle.buildData,routes:bundle.routes,excluded_routes:bundle.excludedRoutes,memory:bundle.memory??functions_config[row.name]?.memory,region:bundle.region??functions_config[row.name]?.region};
  // Schedule changes need an explicit reviewed scheduler release, not accidental activation.
  if(bundle.schedule&&!schedules.some(s=>s.name===row.name&&s.cron===bundle.schedule))throw Error('new_schedule_requires_review');
  functionArtifacts.push({name:row.name,digest,path:bundle.path,invocationMode:bundle.invocationMode,runtimeAPIVersion:bundle.runtimeAPIVersion||1});
 }
 const saved={base,baseline,sourceCommit,files,uploads,functions,functions_config,functionArtifacts,function_schedules:schedules,
  originalFiles:Object.fromEntries(entries.map(x=>[x.path,x.sha])),originalFunctions:Object.fromEntries(deploy.available_functions.map(f=>[f.n,f.d])),originalFunctionMetadata:deploy.available_functions.map(f=>({name:f.n,runtime:f.r,memory:f.m,region:f.rg,invocationMode:f.im||null})),affectedFunctions:affected,createdAt:new Date().toISOString()};
 await writeFile(evidence,JSON.stringify(saved,null,2));console.log(JSON.stringify({prepared:sourceCommit,base,changedFiles:uploads.map(x=>x.path),changedFunctions:approved,environmentUnchanged:true}));
}else{
 const saved=JSON.parse(await readFile(evidence,'utf8')),op=await operatorConfig();
 if(op.site.published_deploy.id!==saved.base)throw Error('production_changed');
 if(action==='draft'){
  const draft=await op.netlify('/sites/'+SITE_ID+'/deploys',{method:'POST',body:JSON.stringify({draft:true,async:true,title:'Secure Enclave policy and customer dashboard — '+saved.sourceCommit.slice(0,7),files:saved.files,functions:saved.functions,functions_config:saved.functions_config,function_schedules:saved.function_schedules})});
  saved.draft=draft.id;saved.url=draft.deploy_ssl_url;await writeFile(evidence,JSON.stringify(saved,null,2));console.log(JSON.stringify({draft:draft.id,url:draft.deploy_ssl_url}));
 }else{
  const draft=await op.netlify('/deploys/'+saved.draft);
  if(action==='upload'){
   if(draft.required_edge_functions?.length)throw Error('edge_reuse_failed');
   for(const digest of draft.required_functions||[])if(!saved.functionArtifacts.some(f=>f.digest===digest))throw Error('unrelated_function_reuse_failed');
   for(const sha of draft.required||[]){const file=saved.uploads.find(f=>f.sha===sha);if(!file)throw Error('unrelated_asset_reuse_failed');await op.netlify('/deploys/'+draft.id+'/files'+file.path,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:await readFile(join(stage,sha))});}
   for(const digest of draft.required_functions||[]){const f=saved.functionArtifacts.find(f=>f.digest===digest);await op.netlify('/deploys/'+draft.id+'/functions/'+f.name+'?runtime=nodejs24.x'+(f.invocationMode?'&invocation_mode='+encodeURIComponent(f.invocationMode):''),{method:'PUT',headers:{'content-type':'application/zip'},body:await readFile(f.path)});}
   console.log(JSON.stringify({uploadedAssets:draft.required?.length||0,uploadedFunctions:draft.required_functions?.length||0}));
  }else if(action==='publish'||action==='verify'){
   if(draft.state!=='ready')throw Error('draft_not_ready');
   const scheduleKey=rows=>JSON.stringify((rows||[]).map(s=>[s.name,s.cron]).sort((a,b)=>a[0].localeCompare(b[0])));
   if(scheduleKey(draft.function_schedules)!==scheduleKey(saved.function_schedules))throw Error('function_schedules_changed');
   if(draft.edge_functions_present)throw Error('edge_function_set_changed');
   const [nextFunctions,nextFiles]=await Promise.all([op.netlify('/deploys/'+draft.id+'/functions'),op.netlify('/deploys/'+draft.id+'/files')]);
   if(nextFunctions.functions.length!==Object.keys(saved.functions).length||nextFunctions.functions.some(f=>saved.functions[f.n]!==f.d))throw Error('function_set_changed');
   for(const expected of saved.originalFunctionMetadata||[]){
    if(saved.functionArtifacts.some(f=>f.name===expected.name))continue;
    const actual=nextFunctions.functions.find(f=>f.n===expected.name);
    if(!actual||actual.r!==expected.runtime||actual.m!==expected.memory||actual.rg!==expected.region||(actual.im||null)!==expected.invocationMode)throw Error('unrelated_function_metadata_changed');
   }
   // Netlify's file-list API canonicalizes names to lowercase. Keep exact count,
   // collision and digest checks; also verify original-case URLs actually serve
   // the intended bytes rather than assuming equivalent URL routing.
   const expected=Object.entries(saved.files),map=new Map(nextFiles.map(f=>[f.path.toLowerCase(),f]));
   if(map.size!==nextFiles.length||new Set(expected.map(([path])=>path.toLowerCase())).size!==expected.length)throw Error('asset_path_collision');
   if(nextFiles.length!==expected.length)throw Error('asset_set_changed');
   for(const [path,sha]of expected){
    const actual=map.get(path.toLowerCase());
    if(actual?.sha!==sha)throw Error('asset_set_changed');
    if(actual.path!==path){
     const response=await fetch(draft.deploy_ssl_url+path,{redirect:'error',signal:AbortSignal.timeout(20000)});
     if(!response.ok||hash(Buffer.from(await response.arrayBuffer()))!==sha)throw Error('asset_url_bytes_changed');
    }
   }
   if(action==='verify')console.log(JSON.stringify({verified:draft.id,source:saved.sourceCommit,functions:nextFunctions.functions.length,files:nextFiles.length,published:false}));
   else{
    await op.netlify('/sites/'+SITE_ID+'/deploys/'+draft.id+'/restore',{method:'POST'});
    saved.publishedAt=new Date().toISOString();await writeFile(evidence,JSON.stringify(saved,null,2));console.log(JSON.stringify({published:draft.id,source:saved.sourceCommit,rollback:saved.base}));
   }
  }else if(action==='status')console.log(JSON.stringify({id:draft.id,state:draft.state,url:draft.deploy_ssl_url}));
  else throw Error('unknown_release_action');
 }
}
