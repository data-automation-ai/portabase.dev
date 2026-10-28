// Operator-only; never bundled into the site. Defaults to read-only migration plan.
import {createHash,randomBytes} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {getStore} from '@netlify/blobs';
import {operatorConfig,SITE_ID,AUTH_REF} from '../cloud/confidential/operator-config.mjs';
import {resolveCasesEditorEmail} from './lib/cases-editor-identity.mjs';
import {historicalCases} from '../src/data/historical-case-seed.mjs';
import {readCases,seedCases} from '../netlify/shared/cases-store.mjs';
const action=process.argv[2]||'plan';
const option=name=>process.argv.find(x=>x.startsWith('--'+name+'='))?.slice(name.length+3);
if(!['plan','seed','editor-add','editor-remove','partner-create','partner-revoke'].includes(action))throw Error('unknown_cases_action');
const op=await operatorConfig(),token=op.value('NETLIFY_BLOBS_TOKEN');
if(!token)throw Error('private_store_token_required');
const store=name=>getStore({name,siteID:SITE_ID,token,consistency:'strong'}),db=store('portabase-cases'),access=store('portabase-cases-access');
if(action==='plan'){
  const current=await readCases(db,{editor:true}),config=await access.get('access-v1',{type:'json'});
  console.log(JSON.stringify({siteId:SITE_ID,existingCases:current.cases.length,seedCases:historicalCases().length,
    editors:config?.editors||[],partners:Object.entries(config?.partners||{}).map(([id,p])=>({id,name:p.name,revoked:p.revoked,dailyLimit:p.dailyLimit})),changes:false}));
}else if(action==='seed'){
  console.log(JSON.stringify({siteId:SITE_ID,...await seedCases(db,historicalCases())}));
}else{
  const saved=await access.getWithMetadata('access-v1',{type:'json'}),config=saved?.data||{version:1,editors:[],partners:{}};
  if(config.version!==1||!Array.isArray(config.editors)||!config.partners)throw Error('access_record_invalid');
  let result={siteId:SITE_ID,action};
  if(action.startsWith('editor-')){
    if(option('user')&&option('email'))throw Error('one_editor_identifier_required');
    const userId=option('email')?await resolveCasesEditorEmail(op.supabase,AUTH_REF,option('email')):option('user');
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId||''))throw Error('verified_supabase_user_id_required');
    // Exact verified identity only; no email wildcard or self-enrollment.
    config.editors=action==='editor-add'?[...new Set([...config.editors,userId])]:config.editors.filter(id=>id!==userId);
    result.userId=userId;
  }else if(action==='partner-create'){
    const name=option('name'),limit=Number(option('daily-limit')||100);
    if(!name||name.length>120||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('partner_name_and_daily_limit_required');
    const id=randomBytes(8).toString('hex'),credential='pbc_'+id+'_'+randomBytes(32).toString('base64url');
    const output=option('secret-out');if(!output)throw Error('explicit_secret_output_required');
    const location=resolve(output),allowed=resolve('.portabase');
    if(location.startsWith('F:')||!location.startsWith(allowed+sep))throw Error('secret_output_must_be_in_ignored_portabase_directory');
    await mkdir(dirname(location),{recursive:true});
    await writeFile(location,credential+'\n',{flag:'wx',mode:0o600});
    config.partners[id]={name,dailyLimit:limit,tokenHash:createHash('sha256').update(credential).digest('hex'),revoked:false,createdAt:new Date().toISOString()};
    result={...result,id,name,secretFile:location,credentialPrinted:false};
  }else{
    const id=option('id');if(!/^[a-f0-9]{16}$/.test(id||'')||!config.partners[id])throw Error('known_partner_id_required');
    config.partners[id].revoked=true;config.partners[id].revokedAt=new Date().toISOString();result.id=id;
  }
  const write=await access.setJSON('access-v1',config,saved?{onlyIfMatch:saved.etag}:{onlyIfNew:true});
  if(!write.modified)throw Error('access_changed_retry_after_review');
  console.log(JSON.stringify(result));
}
