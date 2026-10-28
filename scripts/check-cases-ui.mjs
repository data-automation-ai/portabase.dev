// Isolated browser contexts + injected in-memory API. Never authenticates a real account.
import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCasesHandler} from '../netlify/functions/cases.mjs';
import {createCasesSubmitHandler} from '../netlify/functions/cases-submit.mjs';
import {createCasesManageHandler} from '../netlify/functions/cases-manage.mjs';
import {seedCases} from '../netlify/shared/cases-store.mjs';
const base=process.argv[2]||'http://127.0.0.1:58456',out='.portabase/cases-ui-20261028';
await mkdir(out,{recursive:true});
const user={id:'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',cloudVersion:'supabase',emailVerified:true};
const credential='pbc_aaaaaaaaaaaaaaaa_'+ 'x'.repeat(43);
const config={version:1,editors:[user.id],partners:{aaaaaaaaaaaaaaaa:{name:'Fixture contributor',dailyLimit:100,revoked:false,tokenHash:createHash('sha256').update(credential).digest('hex')}}};
const initial={id:'fixture-1',kind:'firsthand',tag:'ACCOUNT ACCESS',date:'2026-10-28',title:'A customer reported a dashboard lockout.',body:'The original post describes a failed account sign-in and a request for support.',source:'Example · Oct 28, 2026',href:'https://example.com/incident',verified:'Synthetic UI fixture; not a published real report.'};
function memory(){const rows=new Map();let n=0;return {async getWithMetadata(k){return structuredClone(rows.get(k)||null);},async setJSON(k,data,c={}){const old=rows.get(k);if(c.onlyIfNew&&old||c.onlyIfMatch&&old?.etag!==c.onlyIfMatch)return {modified:false};rows.set(k,{data:structuredClone(data),etag:String(++n)});return {modified:true};}};}
const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const width of [1440,768,390,320]){
  const db=memory();await seedCases(db,[initial]);
  const handlers={cases:createCasesHandler({database:()=>db}),'cases/submit':createCasesSubmitHandler({database:()=>db,configuration:async()=>config}),'cases/manage':createCasesManageHandler({database:()=>db,configuration:async()=>config,authenticate:async()=>user})};
  const context=await browser.newContext({viewport:{width,height:960}});
  await context.addInitScript(()=>localStorage.setItem('portabase.sim_customer_token','sim_customer_'+btoa(JSON.stringify({id:'fixture-editor',email:'editor@example.test'}))));
  await context.route('**/api/cases**',async route=>{
    const req=route.request(),url=new URL(req.url()),key=url.pathname.slice(5),handler=handlers[key];
    const headers=req.headers();delete headers.origin;
    const response=await handler(new Request('https://portabase.dev'+url.pathname+url.search,{method:req.method(),headers,...(req.method()==='POST'?{body:req.postData()}: {})}));
    await route.fulfill({status:response.status,contentType:'application/json',body:await response.text()});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/cases/manage',{waitUntil:'networkidle'});await page.getByRole('button',{name:'Add a case',exact:true}).waitFor({state:'visible'});
  await page.getByRole('combobox',{name:/Show/}).selectOption('published');await page.getByRole('button',{name:/A customer reported a dashboard lockout/}).click();
  await page.getByLabel('Headline',{exact:true}).fill('Reviewed headline from the isolated fixture.');
  if(await page.getByRole('button',{name:'Publish saved draft',exact:true}).isEnabled())throw Error('unsaved_publish_allowed');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('Draft saved. Publish when your review is complete.',{exact:true}).waitFor();
  const publicBefore=await handlers.cases(new Request('https://portabase.dev/api/cases'));if((await publicBefore.json()).cases[0].title!==initial.title)throw Error('draft_leaked');
  await page.getByRole('button',{name:'Publish saved draft',exact:true}).click();await page.getByText('Published. This version is now in the public feed.',{exact:true}).waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('editor_overflow');
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/editor-${width}.png`,fullPage:true});
  await page.goto(base+'/#stories',{waitUntil:'networkidle'});await page.getByText('Reviewed headline from the isolated fixture.',{exact:true}).waitFor();
  await page.locator('#stories').scrollIntoViewIfNeeded();if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('public_overflow');await page.screenshot({path:`${out}/public-${width}.png`});
  await page.goto(base+'/cases/submit',{waitUntil:'networkidle'});
  await page.getByLabel('Partner credential',{exact:true}).fill(credential);await page.getByLabel('Your stable report reference',{exact:true}).fill('fixture-'+width);
  for(const[label,value]of [['Case label','ACCOUNT ACCESS'],['Original report date','2026-10-28'],['Headline','Partner report pending review.'],['What the source reports','A synthetic source-backed report for the isolated browser check.'],['Public source URL','https://example.com/partner-'+width],['Source and date label','Example · Oct 28, 2026'],['Evidence and limitations','Synthetic fixture; not a real report.']])await page.getByLabel(label,{exact:true}).fill(value);
  await page.getByRole('button',{name:'Submit for review',exact:true}).click();await page.getByRole('status').filter({hasText:'Submission received.'}).waitFor();
  if(await page.getByLabel('Partner credential',{exact:true}).inputValue())throw Error('credential_not_cleared');
  if(await page.evaluate(token=>JSON.stringify({...localStorage,...sessionStorage}).includes(token),credential))throw Error('credential_persisted');
  const publicAfter=await (await handlers.cases(new Request('https://portabase.dev/api/cases'))).json();if(publicAfter.cases.length!==1)throw Error('partner_bypassed_review');
  const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));if(metrics.scrollWidth>width+1||errors.length)throw Error(JSON.stringify({metrics,errors}));
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:`${out}/partner-${width}.png`,fullPage:true});results.push({width,editorPublished:true,draftHidden:true,partnerPending:true,credentialNotPersisted:true,overflow:false,errors});await context.close();
 }
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({viewports:results.length,flows:results.length*3,evidence:out}));
}finally{await browser.close();}
