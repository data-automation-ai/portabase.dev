import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
const siteId='794217cc-42ab-4a9f-81da-06a661403573';
const stage='.portabase/picker-rescue';
const hash=x=>createHash('sha1').update(x).digest('hex');
const cfg=JSON.parse(await readFile(join(process.env.APPDATA,'netlify/Config/config.json'),'utf8'));
const token=cfg.users?.[cfg.userId]?.auth?.token;
if(!token)throw Error('operator_login_required');
async function api(path,options={}){
 const r=await fetch('https://api.netlify.com/api/v1'+path,{...options,headers:{Authorization:`Bearer ${token}`,'content-type':'application/json',...options.headers},signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error(`netlify_${r.status}`);return r.status===204?null:r.json();
}
const site=await api('/sites/'+siteId);
if(site.custom_domain!=='portabase.dev')throw Error('site_mismatch');
const mode=process.argv[2]||'prepare';
await mkdir(stage,{recursive:true});
if(mode==='prepare'){
 const base=site.published_deploy.id,deploy=await api('/deploys/'+base),entries=await api('/deploys/'+base+'/files');
 if(deploy.edge_functions_present)throw Error('edge_review_required');
 const files=Object.fromEntries(entries.map(e=>[e.path,e.sha])),uploads=[];
 async function load(path){const entry=entries.find(e=>e.path.toLowerCase()===path.toLowerCase());if(!entry)throw Error('missing_asset');const r=await fetch(`https://${base}--portabase-dev.netlify.app${path}`);const bytes=Buffer.from(await r.arrayBuffer());if(hash(bytes)!==entry.sha)throw Error('baseline_hash_mismatch');return bytes.toString();}
 function once(text,from,to){if(text.split(from).length!==2)throw Error('unexpected_bundle_shape');return text.replace(from,to);}
 async function add(path,content){const sha=hash(content);files[path]=sha;uploads.push({path,sha});await writeFile(stage+'/'+sha,content);}
 const html=await load('/index.html');
 const mainPath=html.match(/\/assets\/index-[\w-]+\.js/)?.[0];if(!mainPath)throw Error('missing_entry');
 const main=await load(mainPath),authName=main.match(/auth-pages-[\w-]+\.js/)?.[0];if(!authName)throw Error('missing_auth_chunk');
 const auth=await load('/assets/'+authName);
 // Exact counterpart of source commit c42c8c2: render the existing full selector screen.
 let fixed=once(auth,'default:ye=(0,U.jsx)(ru,{...ve});break}','default:ye=(0,U.jsx)(Sl,{...ve});break}');
 fixed=once(fixed,'className:`pb-console pb-single-view`,style:e.page===`dashboard`?{background:`#ffffff`}:void 0,','className:`pb-console pb-single-view`,');
 if(!auth.includes('function Sl(')||!auth.includes('Filter schemas, buckets, or individual object names...'))throw Error('original_picker_missing');
 // All sibling chunks import the entry's React runtime. Rename the complete
 // current module graph together so only one React instance is loaded.
 const mainName=mainPath.split('/').pop();
 const names=new Set([mainName,authName,...[...main.matchAll(/(?:auth-pages|site-pages|backend-page)-[\w-]+\.js/g)].map(m=>m[0])]);
 const rename=Object.fromEntries([...names].map(n=>[n,'picker2-'+n]));
 for(const name of names){
  let content=name===authName?fixed:name===mainName?main:await load('/assets/'+name);
  for(const [before,after] of Object.entries(rename))content=content.replaceAll(before,after);
  await add('/assets/'+rename[name],content);
 }
 await add('/index.html',once(html,mainPath,'/assets/'+rename[mainName]));
 const functions=Object.fromEntries(deploy.available_functions.map(f=>[f.n,f.d]));
 const functions_config=Object.fromEntries(deploy.available_functions.map(f=>[f.n,{runtime:f.r,display_name:f.dn,generator:f.g}]));
 await writeFile(stage+'/release.json',JSON.stringify({base,sourceCommit:'c42c8c2',files,uploads,functions,functions_config,function_schedules:deploy.function_schedules||[]},null,2));
 console.log(JSON.stringify({prepared:true,base,changed:uploads.map(x=>x.path),preservedFunctions:Object.keys(functions).length}));
}else{
 const release=JSON.parse(await readFile(stage+'/release.json','utf8'));
 if(mode==='draft'){
  if(site.published_deploy.id!==release.base)throw Error('production_changed');
  const d=await api('/sites/'+siteId+'/deploys',{method:'POST',body:JSON.stringify({draft:true,async:true,title:'Restore original advanced table and file picker — c42c8c2',files:release.files,functions:release.functions,functions_config:release.functions_config,function_schedules:release.function_schedules})});
  release.draft=d.id;await writeFile(stage+'/release.json',JSON.stringify(release,null,2));console.log(JSON.stringify({draft:d.id,url:d.deploy_ssl_url}));
 }else{
  const d=await api('/deploys/'+release.draft);
  if(mode==='upload'){
   if(d.required_functions?.length||d.required_edge_functions?.length)throw Error('backend_reuse_failed');
   for(const sha of d.required||[]){const f=release.uploads.find(x=>x.sha===sha);if(!f)throw Error('unexpected_upload');await api('/deploys/'+d.id+'/files'+f.path,{method:'PUT',headers:{'content-type':'application/octet-stream'},body:await readFile(stage+'/'+sha)});}
   console.log(JSON.stringify({uploaded:d.required?.length||0}));
  }else if(mode==='publish'){
   if(d.state!=='ready'||site.published_deploy.id!==release.base)throw Error('release_state_changed');
   const next=await api('/deploys/'+d.id+'/functions');
   if(next.functions.length!==Object.keys(release.functions).length||next.functions.some(f=>release.functions[f.n]!==f.d))throw Error('functions_changed');
   await api('/sites/'+siteId+'/deploys/'+d.id+'/restore',{method:'POST'});console.log(JSON.stringify({published:d.id,rollback:release.base}));
  }else console.log(JSON.stringify({id:d.id,state:d.state,url:d.deploy_ssl_url}));
 }
}
