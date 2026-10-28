import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {historicalCases} from '../src/data/historical-case-seed.mjs';
import {CASES_KEY,seedCases,readCases,submitCase,editCase,validateCase} from '../netlify/shared/cases-store.mjs';
import {createCasesHandler} from '../netlify/functions/cases.mjs';
import {createCasesSubmitHandler} from '../netlify/functions/cases-submit.mjs';
import {createCasesManageHandler} from '../netlify/functions/cases-manage.mjs';

function memory(){const rows=new Map();let seq=0;return {
 async get(key){return structuredClone(rows.get(key)?.data??null);},
 async getWithMetadata(key){return structuredClone(rows.get(key)||null);},
 async setJSON(key,value,condition={}){const old=rows.get(key);if(condition.onlyIfNew&&old||condition.onlyIfMatch&&old?.etag!==condition.onlyIfMatch)return {modified:false};rows.set(key,{data:structuredClone(value),etag:String(++seq)});return {modified:true};},
};}
const content=(suffix='1')=>({kind:'firsthand',date:'2026-10-28',tag:'ACCOUNT ACCESS',title:'A reported account lockout '+suffix,body:'The poster reports a loss of dashboard access.',source:'Example · Oct 28, 2026',href:'https://example.com/reports/'+suffix,verified:'Community report; cause not independently verified'});
const partner={id:'a'.repeat(16),name:'Fixture partner',dailyLimit:10};
const editor='b'.repeat(8)+'-bbbb-bbbb-bbbb-'+ 'b'.repeat(12);
const user={id:editor,cloudVersion:'supabase',emailVerified:true};
const credential='pbc_'+partner.id+'_'+ 'x'.repeat(43);
const config={version:1,editors:[editor],partners:{[partner.id]:{name:partner.name,dailyLimit:10,tokenHash:createHash('sha256').update(credential).digest('hex'),revoked:false}}};
const post=(url,body,auth=credential)=>new Request('https://portabase.dev'+url,{method:'POST',headers:{'content-type':'application/json',Authorization:'Bearer '+auth},body:JSON.stringify(body)});
const mutation=(record,action,extra={})=>({action,id:record.id,revision:record.revision,requestId:randomUUID(),...extra});

test('migration preserves all 128 existing reports and never overwrites an edited record',async()=>{
 const db=memory(),rows=historicalCases();assert.equal(rows.length,128);
 assert.deepEqual(await seedCases(db,rows),{added:128,total:128});assert.equal((await readCases(db)).cases.length,128);
 const record=(await readCases(db,{editor:true})).cases[0];
 await editCase(db,mutation(record,'update',{content:{...record.content,date:'2026-10-28',title:'Editorial correction'}}),{editor});
 assert.equal((await seedCases(db,rows)).added,0);
 assert.equal((await readCases(db,{editor:true})).cases.find(r=>r.id===record.id).content.title,'Editorial correction');
 const snapshot=JSON.parse(await readFile(new URL('../public/data/cases-snapshot.json',import.meta.url),'utf8'));
 assert.deepEqual(snapshot.cases,rows);
});
test('partner submissions are private, idempotent, source-deduplicated and cannot publish fields',async()=>{
 const db=memory(),created=await submitCase(db,{partner,externalId:'report-1',content:content()});assert.equal(created.state,'pending');
 assert.equal((await readCases(db)).cases.length,0);
 assert.deepEqual(await submitCase(db,{partner,externalId:'report-1',content:content()}),{...created,duplicate:true});
 await assert.rejects(()=>submitCase(db,{partner,externalId:'report-1',content:content('changed')}),/submission_id_conflict/);
 await assert.rejects(()=>submitCase(db,{partner:{...partner,id:'c'.repeat(16)},externalId:'report-2',content:content()}),/case_source_already_submitted/);
 assert.throws(()=>validateCase({...content(),published:true}),/invalid_case/);
});
test('concurrent submissions share a durable per-partner daily limit without lost records',async()=>{
 const db=memory(),limited={...partner,dailyLimit:1};
 const results=await Promise.allSettled([submitCase(db,{partner:limited,externalId:'a',content:content('a')}),submitCase(db,{partner:limited,externalId:'b',content:content('b')})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await readCases(db,{editor:true})).cases.length,1);
});
test('draft edits stay separate from public snapshots; stale editors cannot overwrite or publish',async()=>{
 const db=memory();const submitted=await submitCase(db,{partner,externalId:'a',content:content()});
 let record=(await readCases(db,{editor:true})).cases.find(r=>r.id===submitted.id);
 const before=record;record=(await editCase(db,mutation(record,'publish'),{editor})).record;
 assert.equal((await readCases(db)).cases[0].title,content().title);
 await assert.rejects(()=>editCase(db,mutation(before,'update',{content:content('different')}),{editor}),/case_changed_reload_required/);
 record=(await editCase(db,mutation(record,'update',{content:{...record.content,title:'Corrected title'}}),{editor})).record;
 assert.equal((await readCases(db)).cases[0].title,content().title);
 record=(await editCase(db,mutation(record,'publish'),{editor})).record;
 assert.equal((await readCases(db)).cases[0].title,'Corrected title');
 await editCase(db,mutation(record,'unpublish'),{editor});assert.equal((await readCases(db)).cases.length,0);
 assert.equal((await readCases(db,{editor:true})).cases.length,1);
});
test('invalid dates, executable URLs, control bytes and oversize fields are rejected',()=>{
 for(const change of [{href:'javascript:alert(1)'},{href:'https://name:secret@example.com/x'},{date:'2026-02-30'},{title:'x'.repeat(241)},{body:'hidden\0payload'}])assert.throws(()=>validateCase({...content(),...change}),/invalid_case/);
 assert.throws(()=>validateCase({...content(),date:undefined}),/case_date_required/);
});
test('editor retries bind the exact operation and cannot reuse a request id to publish different content',async()=>{
 const db=memory(),body={action:'create',content:content(),requestId:randomUUID()};
 const first=await editCase(db,body,{editor});const retry=await editCase(db,body,{editor});assert.equal(retry.duplicate,true);assert.equal(retry.record.id,first.record.id);
 await assert.rejects(()=>editCase(db,{...body,content:content('other')},{editor}),/editor_request_conflict/);
});
test('prototype-shaped ids and missing or noninteger revisions never access inherited records',async()=>{
 const db=memory();
 for(const id of ['__proto__','constructor','prototype']){
   await assert.rejects(()=>editCase(db,{action:'reject',id,requestId:randomUUID()},{editor}),/invalid_case_id/);
   await assert.rejects(()=>seedCases(db,[{...content(),id}]),/invalid_seed_id/);
 }
 for(const revision of [undefined,0,1.5,'1'])await assert.rejects(()=>editCase(db,{action:'reject',id:'missing',revision,requestId:randomUUID()},{editor}),/invalid_case_revision/);
 assert.equal(Object.prototype.state,undefined);assert.equal((await readCases(db,{editor:true})).cases.length,0);
});
test('partner HTTP access is scoped, revocable and cannot spoof editorial fields',async()=>{
 const db=memory(),handler=createCasesSubmitHandler({database:()=>db,configuration:async()=>structuredClone(config)});
 assert.equal((await handler(post('/api/cases/submit',{externalId:'a',case:content()}))).status,202);
 assert.equal((await handler(post('/api/cases/submit',{externalId:'b',case:content('b'),publish:true}))).status,400);
 assert.equal((await handler(post('/api/cases/submit',{externalId:'c',case:content('c')},'wrong'))).status,401);
 const revoked=structuredClone(config);revoked.partners[partner.id].revoked=true;
 const deny=createCasesSubmitHandler({database:()=>db,configuration:async()=>revoked});
 assert.equal((await deny(post('/api/cases/submit',{externalId:'d',case:content('d')}))).status,401);
});
test('normal customers, unverified accounts, partner credentials and cross-origin callers cannot edit',async()=>{
 const db=memory(),make=identity=>createCasesManageHandler({database:()=>db,configuration:async()=>config,authenticate:async()=>identity});
 const request=new Request('https://portabase.dev/api/cases/manage');
 assert.equal((await make({...user,id:randomUUID()})(request)).status,403);
 assert.equal((await make({...user,emailVerified:false})(request)).status,403);
 assert.equal((await createCasesManageHandler({authenticate:async()=>{throw Error();}})(request)).status,401);
 const bad=new Request('https://portabase.dev/api/cases/manage',{headers:{origin:'https://evil.example'}});
 assert.equal((await make(user)(bad)).status,403);
 const good=await make(user)(request);assert.equal(good.status,200);
});
test('public responses contain published fields only and outage never becomes healthy empty data',async()=>{
 const db=memory(),handler=createCasesHandler({database:()=>db}),request=new Request('https://portabase.dev/api/cases');
 assert.equal((await handler(request)).status,503);
 await seedCases(db,historicalCases());await submitCase(db,{partner,externalId:'private',content:content('private')});
 const response=await handler(request),json=await response.json();assert.equal(response.status,200);assert.equal(json.cases.length,128);
 const serialized=JSON.stringify(json);for(const field of ['submittedBy','submissionHash','tokenHash','externalId','private'])assert.equal(serialized.includes(field),false);
 const broken=createCasesHandler({database:()=>({getWithMetadata:async()=>{throw Error('sensitive provider detail');}})});
 const unavailable=await broken(request);assert.equal(unavailable.status,503);assert.deepEqual(await unavailable.json(),{error:'cases_service_unavailable'});
 await db.setJSON(CASES_KEY,{version:1,revision:1,records:{bad:'corrupt'},audit:[],partners:{}});
 const corrupt=await handler(request);assert.equal(corrupt.status,503);assert.equal((await corrupt.json()).error,'cases_store_invalid');
});
test('public and editorial responses paginate without dropping records',async()=>{
 const db=memory();await seedCases(db,Array.from({length:205},(_,i)=>({id:'seed'+i,...content(String(i))})));
 const handler=createCasesHandler({database:()=>db});
 const first=await (await handler(new Request('https://portabase.dev/api/cases'))).json();
 assert.equal(first.cases.length,200);assert.equal(first.nextOffset,200);
 const last=await (await handler(new Request('https://portabase.dev/api/cases?offset=200'))).json();assert.equal(last.cases.length,5);assert.equal(last.nextOffset,null);
 const manage=createCasesManageHandler({database:()=>db,configuration:async()=>config,authenticate:async()=>user});
 const review=await (await manage(new Request('https://portabase.dev/api/cases/manage'))).json();assert.equal(review.cases.length,100);assert.equal(review.counts.total,205);
});
