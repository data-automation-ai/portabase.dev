// Content-only release: preserve the live service bundle and all existing files.
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {researchOfficial2026} from '../src/data/research-official-2026.js';
import {researchCommunity2026} from '../src/data/research-community-2026.js';
import {nightmares} from '../src/data/nightmares.js';
const siteId='794217cc-42ab-4a9f-81da-06a661403573';
const out='research-output/incident-publication';
const config=JSON.parse(await readFile(join(process.env.APPDATA,'netlify/Config/config.json'),'utf8'));
const token=config.users?.[config.userId]?.auth?.token;
if(!token)throw Error('netlify_auth_missing');
async function api(path, method='GET', body, binary=false) {
  const r=await fetch(`https://api.netlify.com/api/v1${path}`,{method,
    headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':binary?'application/octet-stream':'application/json'}:{})},
    body:body?(binary?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error(`netlify_${method}_${r.status}`);
  return r.json();
}
const site=await api(`/sites/${siteId}`);
if(site.name!=='portabase-dev'||site.custom_domain!=='portabase.dev')throw Error('site_mismatch');
const mode=process.argv[2]||'prepare';
await mkdir(out,{recursive:true});
if(mode==='prepare') {
  const baseline=site.published_deploy;
  const manifest=await api(`/sites/${siteId}/files`);
  const service=await api(`/deploys/${baseline.id}/functions`);
  const deploy=await api(`/deploys/${baseline.id}`);
  if(deploy.edge_functions_present||deploy.server)throw Error('unexpected_edge_or_server');
  const additions=[...researchOfficial2026,...researchCommunity2026];
  const js=manifest.filter(f=>f.path.endsWith('.js'));
  const rename=Object.fromEntries(js.map(f=>[f.path.split('/').pop(),`evidence-20261027-${f.path.split('/').pop()}`]));
  const files=Object.fromEntries(manifest.map(f=>[f.path,f.sha]));
  const uploads=[];
  let patched=0;
  for(const f of [...js,...manifest.filter(f=>f.path==='/index.html')]) {
    const r=await fetch(baseline.deploy_ssl_url+f.path,{signal:AbortSignal.timeout(25000)});
    if(!r.ok)throw Error('baseline_fetch_failed');
    const bytes=Buffer.from(await r.arrayBuffer());
    if(createHash('sha1').update(bytes).digest('hex')!==f.sha)throw Error('baseline_hash_mismatch');
    let content=bytes.toString('utf8');
    const marker='{id:`N01`';
    if(content.includes(marker)) {
      if(content.split(marker).length!==2)throw Error('ambiguous_archive');
      for(const a of additions)if(content.includes(a.href))throw Error(`existing_source_${a.id}`);
      content=content.replace(marker,additions.map(a=>JSON.stringify(a)).join(',')+','+marker);
      const start=content.indexOf('{id:`N52`');
      const end=content.indexOf('}',start)+1;
      if(start<0||end<=start||!content.slice(start,end).includes('43795'))throw Error('correction_not_found');
      content=content.slice(0,start)+JSON.stringify(nightmares.find(x=>x.id==='N52'))+content.slice(end);
      patched++;
    }
    // Netlify's file inventory normalizes paths to lowercase; asset references may not.
    for(const [oldName,newName] of Object.entries(rename))content=content.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'gi'),newName);
    const path=f.path.endsWith('.js')?f.path.replace(/[^/]+$/,rename[f.path.split('/').pop()]):f.path;
    const sha=createHash('sha1').update(content).digest('hex');
    files[path]=sha;
    await writeFile(`${out}/${sha}`,content);
    uploads.push({path,sha});
  }
  if(patched!==1)throw Error('archive_patch_count');
  const functions=Object.fromEntries(service.functions.map(f=>[f.n,f.d]));
  const functions_config=Object.fromEntries(service.functions.map(f=>[f.n,{runtime:f.r,display_name:f.dn,generator:f.g}]));
  await writeFile(`${out}/release.json`,JSON.stringify({baseline:baseline.id,baselineUrl:baseline.deploy_ssl_url,
    count:additions.length,files,uploads,functions,functions_config,function_schedules:deploy.function_schedules||[]},null,2));
  console.log(JSON.stringify({prepared:true,baseline:baseline.id,added:additions.length,functions:service.functions.length,changedAssets:uploads.length}));
} else {
  const release=JSON.parse(await readFile(`${out}/release.json`,'utf8'));
  if(mode==='draft') {
    if(site.published_deploy.id!==release.baseline)throw Error('production_changed');
    const d=await api(`/sites/${siteId}/deploys`,'POST',{draft:true,async:true,files:release.files,functions:release.functions,
      functions_config:release.functions_config,function_schedules:release.function_schedules,
      title:`Add ${release.count} reviewed 2026 cases; preserve live functions and recovery routes`});
    release.draft=d.id;await writeFile(`${out}/release.json`,JSON.stringify(release,null,2));
    if(d.required_functions?.length||d.required_edge_functions?.length)throw Error('function_reuse_failed');
    for(const sha of d.required||[]) {
      const f=release.uploads.find(f=>f.sha===sha);if(!f)throw Error('unexpected_file_upload');
      await api(`/deploys/${d.id}/files${f.path}`,'PUT',await readFile(`${out}/${sha}`),true);
    }
    console.log(JSON.stringify({draft:d.id,url:d.deploy_ssl_url,state:d.state}));
  } else if(mode==='upload') {
    const d=await api(`/deploys/${release.draft}`);
    if(d.required_functions?.length||d.required_edge_functions?.length)throw Error('function_reuse_failed');
    for(const sha of d.required||[]) {
      const f=release.uploads.find(f=>f.sha===sha);if(!f)throw Error('unexpected_file_upload');
      await api(`/deploys/${d.id}/files${f.path}`,'PUT',await readFile(`${out}/${sha}`),true);
    }
    console.log(JSON.stringify({uploaded:d.required?.length||0,deploy:d.id}));
  } else if(mode==='verify'||mode==='publish') {
    const d=await api(`/deploys/${release.draft}`);
    const f=await api(`/deploys/${release.draft}/functions`);
    if(d.state!=='ready')throw Error(`draft_${d.state}`);
    if(f.functions.length!==Object.keys(release.functions).length||f.functions.some(f=>release.functions[f.n]!==f.d))throw Error('functions_changed');
    if(mode==='publish') {
      if(site.published_deploy.id!==release.baseline)throw Error('production_changed');
      await api(`/sites/${siteId}/deploys/${release.draft}/restore`,'POST',{});
    }
    console.log(JSON.stringify({mode,deploy:d.id,url:d.deploy_ssl_url,functionsPreserved:f.functions.length}));
  } else throw Error('unknown_mode');
}
