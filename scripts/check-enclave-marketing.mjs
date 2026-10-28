import {chromium} from 'playwright';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.argv[2]||'http://127.0.0.1:58456',out='.portabase/marketing-qa-20261028';
await mkdir(out,{recursive:true});const browser=await chromium.launch({headless:true}),results=[];
try{
 for(const route of ['/','/security','/legal'])for(const width of [1440,768,390,320]){
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+route,{waitUntil:'networkidle'});await page.locator('h1').first().waitFor();
  const metrics=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth,h1:document.querySelector('h1').textContent,title:document.title}));
  if(metrics.scrollWidth>width+1||errors.length)throw Error(JSON.stringify({route,...metrics,errors}));
  if(route==='/'){
   for(const stale of ['.trust-board','.diagram-grid','#never-hold-keys','.hero-concept-section','.escape-viz','.architecture-open-core','.cloud-sideband'])if(await page.locator(stale).count())throw Error('stale_section:'+stale);
   if(await page.locator('#secure-enclave .enclave-capability-grid article').count()!==3)throw Error('enclave_cards_missing');
  }
  const label=route==='/'?'home':route.slice(1);await page.screenshot({path:`${out}/${label}-${width}.png`});
  if(route==='/'&&(width===1440||width===390)){await page.locator('#secure-enclave').scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/enclave-${width}.png`});}
  results.push({route,...metrics,errors});await page.close();
 }
 await writeFile(`${out}/results.json`,JSON.stringify(results,null,2));console.log(JSON.stringify({checks:results.length,overflow:false,pageErrors:0,evidence:out}));
}finally{await browser.close();}
