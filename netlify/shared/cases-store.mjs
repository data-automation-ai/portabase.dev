import {createHash} from 'node:crypto';
import {getStore} from '@netlify/blobs';
import {incidentKey,sortIncidents} from '../../src/lib/incident-order.js';

export const CASES_KEY='collection-v1';
export const casesDatabase=()=>getStore({name:'portabase-cases',consistency:'strong'});
export const casesFailure=(code,status=400)=>{throw Object.assign(Error(code),{code,status});};
const fields={title:240,body:4000,source:200,href:2048,tag:48,verified:300};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
const validId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(value)&&!['__proto__','constructor','prototype'].includes(value);
export function validateCase(value,{seed=false}={}) {
  if(!object(value)||Object.keys(value).some(k=>!['id','kind','date',...Object.keys(fields)].includes(k)))casesFailure('invalid_case');
  const result={};
  for(const [name,max]of Object.entries(fields)){
    const text=value[name];
    if(typeof text!=='string'||!text.trim()||text.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))casesFailure('invalid_case_'+name);
    result[name]=text.trim();
  }
  let url;try{url=new URL(result.href);}catch{casesFailure('invalid_case_source_url');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!url.hostname.includes('.'))casesFailure('invalid_case_source_url');
  if(!['firsthand','official'].includes(value.kind))casesFailure('invalid_case_kind');
  result.kind=value.kind;
  if(value.date!==undefined){
    if(typeof value.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value.date))casesFailure('invalid_case_date');
    const parsed=new Date(value.date+'T00:00:00Z');
    if(!seed&&(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value.date))casesFailure('invalid_case_date');
    result.date=value.date;
  }else if(!seed)casesFailure('case_date_required');
  return result;
}
function collection(value){
  if(value==null)return {version:1,revision:0,records:{},audit:[],partners:{}};
  if(value.version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!object(value.records)||!Array.isArray(value.audit)||!object(value.partners))casesFailure('cases_store_invalid',503);
  try{
    for(const [id,row]of Object.entries(value.records)){
      if(!validId(id)||!object(row)||row.id!==id||!Number.isSafeInteger(row.revision)||row.revision<1||!['pending','published','draft','rejected'].includes(row.state)
        ||!object(row.submittedBy)||!['partner','editor','migration'].includes(row.submittedBy.kind)||!Number.isFinite(Date.parse(row.updatedAt))||!Number.isFinite(Date.parse(row.createdAt)))throw Error();
      validateCase(row.content,{seed:true});if(row.published!==null)validateCase(row.published,{seed:true});
    }
  }catch{casesFailure('cases_store_invalid',503);}
  return structuredClone(value);
}
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>incidentKey(value);
const event=(state,record,actor,action,now,requestId)=>{
  state.revision++;
  state.audit.push({caseId:record.id,actor,action,at:new Date(now).toISOString(),revision:record.revision,requestId});
  // The full case and its provenance remain; recent editorial audit is bounded.
  if(state.audit.length>10000)state.audit.splice(0,state.audit.length-10000);
};
export async function readCases(db,{editor=false,order='recent'}={}){
  const saved=await db.getWithMetadata(CASES_KEY,{type:'json'});
  if(!saved)return {available:false,revision:0,cases:[]};
  const state=collection(saved.data),records=Object.values(state.records);
  if(editor)return {available:true,revision:state.revision,cases:records.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),audit:state.audit.slice(-100).reverse()};
  return {available:true,revision:state.revision,cases:sortIncidents(records.filter(r=>r.published).map(r=>({id:r.id,...r.published})),order)};
}
async function mutate(db,operation){
  for(let attempt=0;attempt<12;attempt++){
    const saved=await db.getWithMetadata(CASES_KEY,{type:'json'}),state=collection(saved?.data);
    const outcome=operation(state);
    if(outcome.unchanged)return outcome.result;
    if(Object.keys(state.records).length>5000||Buffer.byteLength(JSON.stringify(state))>25*1024*1024)casesFailure('cases_capacity_reached',503);
    const written=await db.setJSON(CASES_KEY,state,saved?{onlyIfMatch:saved.etag}:{onlyIfNew:true});
    if(written.modified)return outcome.result;
  }
  casesFailure('cases_busy_retry',409);
}
export async function submitCase(db,{partner,externalId,content},{now=Date.now()}={}){
  const clean=validateCase(content);
  if(typeof externalId!=='string'||!/^[A-Za-z0-9._:-]{1,120}$/.test(externalId))casesFailure('external_id_required');
  const id='case-'+hash(partner.id+'\n'+externalId).slice(0,32),fingerprint=hash(JSON.stringify(clean)),sourceKey=canonical(clean.href);
  return mutate(db,state=>{
    const old=Object.hasOwn(state.records,id)?state.records[id]:null;
    if(old){if(old.submissionHash!==fingerprint)casesFailure('submission_id_conflict',409);return {unchanged:true,result:{id,state:old.state,duplicate:true}};}
    if(Object.values(state.records).some(r=>canonical(r.content.href)===sourceKey))casesFailure('case_source_already_submitted',409);
    const day=new Date(now).toISOString().slice(0,10),usage=state.partners[partner.id];
    const count=usage?.day===day?usage.count:0;
    if(count>=partner.dailyLimit)casesFailure('partner_daily_limit',429);
    state.partners[partner.id]={day,count:count+1};
    const at=new Date(now).toISOString();
    const record=state.records[id]={id,revision:1,state:'pending',content:clean,published:null,
      submittedBy:{kind:'partner',id:partner.id,name:partner.name},externalId,submissionHash:fingerprint,createdAt:at,updatedAt:at};
    event(state,record,'partner:'+partner.id,'submit',now,externalId);
    return {result:{id,state:'pending',duplicate:false}};
  });
}
export async function editCase(db,body,{editor,now=Date.now()}={}){
  if(!object(body)||Object.keys(body).some(k=>!['action','id','revision','content','requestId'].includes(k))
    ||!['create','update','publish','unpublish','reject'].includes(body.action)||!/^[a-f0-9-]{36}$/i.test(body.requestId||''))casesFailure('invalid_editor_action');
  const id=body.action==='create'?'case-'+hash(editor+'\n'+body.requestId).slice(0,32):body.id;
  if(!validId(id))casesFailure('invalid_case_id');
  if(body.action!=='create'&&(!Number.isSafeInteger(body.revision)||body.revision<1))casesFailure('invalid_case_revision');
  const clean=['create','update'].includes(body.action)?validateCase(body.content):null,commandHash=hash(JSON.stringify(body));
  return mutate(db,state=>{
    let record=Object.hasOwn(state.records,id)?state.records[id]:null;
    const earlier=state.audit.find(a=>a.actor==='editor:'+editor&&a.requestId===body.requestId);
    if(earlier){if(earlier.commandHash!==commandHash)casesFailure('editor_request_conflict',409);return {unchanged:true,result:{record,duplicate:true}};}
    if(body.action==='create'){
      if(record)casesFailure('case_already_exists',409);
      record={id,revision:0,published:null,createdAt:new Date(now).toISOString(),submittedBy:{kind:'editor',id:editor}};
    }else if(!record)casesFailure('case_not_found',404);
    else if(record.revision!==body.revision)casesFailure('case_changed_reload_required',409);
    if(clean){
      if(Object.values(state.records).some(r=>r.id!==id&&canonical(r.content.href)===canonical(clean.href)))casesFailure('case_source_already_submitted',409);
      record.content=clean;record.state='pending';
    }
    if(body.action==='publish'){record.published=validateCase(record.content,{seed:record.submittedBy.kind==='migration'});record.state='published';}
    if(body.action==='unpublish'){record.published=null;record.state='draft';}
    if(body.action==='reject')record.state='rejected';
    record.revision++;record.updatedAt=new Date(now).toISOString();state.records[id]=record;
    event(state,record,'editor:'+editor,body.action,now,body.requestId);
    state.audit.at(-1).commandHash=commandHash;
    return {result:{record,duplicate:false}};
  });
}
/** Operator-only migration. Never called by a public read or partner request. */
export async function seedCases(db,rows,{now=Date.now()}={}){
  const clean=rows.map(row=>({id:row.id,content:validateCase(row,{seed:true})}));
  if(clean.some(r=>!validId(r.id)))casesFailure('invalid_seed_id');
  return mutate(db,state=>{
    let added=0;const sources=new Set(Object.values(state.records).map(r=>canonical(r.content.href)));
    for(const row of clean){
      if(Object.hasOwn(state.records,row.id)||sources.has(canonical(row.content.href)))continue;
      const at=new Date(now).toISOString(),record=state.records[row.id]={id:row.id,revision:1,state:'published',content:row.content,published:row.content,
        submittedBy:{kind:'migration',id:'homepage-20261028'},createdAt:at,updatedAt:at};
      event(state,record,'operator','migrate',now,'seed-'+row.id);sources.add(canonical(row.content.href));added++;
    }
    return {unchanged:!added,result:{added,total:Object.keys(state.records).length}};
  });
}
