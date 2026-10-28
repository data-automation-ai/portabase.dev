// Isolated frontend fixtures. No authentication storage, real account, or provider requests.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const fixture = `import React from 'react';import {createRoot} from 'react-dom/client';
import {UsageOverview} from '/src/console/usage-overview.jsx';
import '/src/console/console.css';
const lastBackup={status:'succeeded',startedAt:'2026-10-28T12:30:00Z',durationMs:163000,outboundBytes:518200000,completeness:'selected',verified:true,manifestVerified:true};
const snapshot={usage:{available:true,recorded:true,periodStart:'2026-10-01T00:00:00Z',periodEnd:'2026-10-31T00:00:00Z',allowanceBytes:10000000000,chargedBytes:3840000000,outboundBytes:4010000000,baselineBytes:170000000,reservedBytes:0,succeeded:27,failed:1,running:0,lastBackup},runnerUsage:{available:true,status:'measured',runnerRuntimeMs:18864000,windowStart:'2026-10-01T00:00:00Z',windowEnd:'2026-10-28T12:30:00Z'},beaconUsage:{available:true,jobsSucceeded:9,jobsFailed:0,lastBeacon:{status:'succeeded',finishedAt:'2026-10-27T12:00:00Z'}}};
const mode=new URLSearchParams(location.search).get('mode');
if(mode==='failed')snapshot.usage.lastBackup={...lastBackup,status:'failed'};
if(mode==='empty'){snapshot.usage={available:true,recorded:false,allowanceBytes:10000000000};snapshot.runnerUsage={available:true,status:'no_samples',runnerRuntimeMs:0};snapshot.beaconUsage=null;}
createRoot(document.getElementById('root')).render(<div className="pb-console" style={{display:'block',padding:12}}><div style={{color:'white',padding:'4px 0 12px'}}>Isolated visual fixture · synthetic data</div><UsageOverview snapshot={mode==='outage'?null:snapshot} onRefresh={()=>{}}/></div>);`;
const compiled = await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'usage-fixture', resolveId(id) { if(id.endsWith('virtual:usage-fixture'))return '\0usage-fixture.jsx'; }, load(id) { if(id==='\0usage-fixture.jsx')return fixture; } }],
  build: { write: false, minify: false, lib: { entry: 'virtual:usage-fixture', formats: ['iife'], name: 'UsageFixture' } } });
const output=(Array.isArray(compiled)?compiled:[compiled]).flatMap(x=>x.output);
const bundle=output.find(x=>x.type==='chunk'&&x.isEntry).code;
const css=output.filter(x=>x.type==='asset'&&x.fileName.endsWith('.css')).map(x=>String(x.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g,'');
const evidence=new URL('../.portabase/usage-overview-review/',import.meta.url);await mkdir(evidence,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try {
  for(const width of [320,390,768,1440])for(const mode of ['measured','empty','outage','failed']){
    const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      assert.equal(url.origin,'https://usage.fixture.test');
      if(url.pathname==='/fixture.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:bundle});
      if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
      return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body style="margin:0"><div id="root"></div><script src="/fixture.js"></script></body></html>'});
    });
    await page.goto(`https://usage.fixture.test/?mode=${mode}`);
    await page.getByRole('heading',{name:'Every run, accounted for.'}).waitFor();
    assert.deepEqual(errors,[]);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,`${width}/${mode} horizontal overflow`);
    const text=await page.locator('.pb-usage').innerText();
    if(mode==='measured'){assert.match(text,/5\.24/);assert.match(text,/3\.84 GB/);assert.match(text,/Selected scope verified/);assert.match(text,/Last beacon succeeded/);assert.equal(await page.getByRole('meter').getAttribute('aria-valuenow'),'3840000000');}
    if(mode==='outage'){assert.match(text,/Backup status unavailable/);assert.doesNotMatch(text,/Selected scope verified/);}
    if(mode==='empty'){assert.match(text,/No metered jobs yet/);assert.match(text,/No uptime samples reported yet/);assert.doesNotMatch(text,/0\.00/);}
    if(mode==='failed'){assert.match(text,/Backup failed/);assert.doesNotMatch(text,/Selected scope verified/);}
    if(mode==='measured'||width===390)await page.screenshot({path:fileURLToPath(new URL(`${width}-${mode}.png`,evidence)),fullPage:true});
    results.push({width,mode,passed:true});await page.close();
  }
} finally {await browser.close();}
console.log(JSON.stringify({passed:results.length,results,evidence:fileURLToPath(evidence)},null,2));
