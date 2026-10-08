import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createMeHandler } from '../netlify/functions/cloud-me.mjs';

// Render actual quota consumers with the real cloud-me response and stale cached
// paid settings. All HTTP requests are intercepted and checkout is captured only.
const fixture = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { BillingPage } from '/src/console/pages.jsx';
  import { CustomerDashboardPage } from '/src/console/customer-dashboard.jsx';
  import { emptyWorkspace } from '/src/console/data/store.js';
  import { fetchMe, startTrialCheckout } from '/src/lib/cloud-api.js';
  import '/src/console/console.css';
  const token='fixture.'+btoa(JSON.stringify({exp:Math.floor(Date.now()/1000)+3600}))+'.fixture';
  localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:token,user:{id:'quota-fixture'}}));
  const state=emptyWorkspace();
  state.billing={...state.billing,plan:'cloud-37',planId:'cloud-37',extraTransfersAddon:true,cyclesPerDay:99};
  window.checkoutRequests=[];
  window.billingWrites=0;
  function Fixture(){
    const [me,setMe]=React.useState(null);
    React.useEffect(()=>{fetchMe().then(setMe)},[]);
    if(!me)return null;
    const props={state,me,liveJobs:[],live:false,demoMode:false,navigate:()=>{},setState:()=>{window.billingWrites++},startTrial: async id=>{await startTrialCheckout('supabase',id);window.checkoutRequests.push(id)},startAddon:()=>{},toast:()=>{}};
    return React.createElement(React.Fragment,null,
      React.createElement('section',{'aria-label':'Dashboard fixture'},React.createElement(CustomerDashboardPage,props)),
      React.createElement('section',{'aria-label':'Billing fixture'},React.createElement(BillingPage,props)));
  }
  createRoot(document.getElementById('root')).render(React.createElement(Fixture));
`;
const compiled = await build({ root: fileURLToPath(new URL('..', import.meta.url)), logLevel: 'error', define: { 'process.env.NODE_ENV': '"production"' },
  plugins: [{ name: 'quota-fixture', resolveId(id) { if (id.endsWith('virtual:quota-fixture')) return '\0quota-fixture'; }, load(id) { if (id === '\0quota-fixture') return fixture; } }],
  build: { write: false, minify: false, lib: { entry: 'virtual:quota-fixture', formats: ['iife'], name: 'QuotaFixture' } },
});
const output = (Array.isArray(compiled) ? compiled : [compiled]).flatMap(item => item.output);
const bundle = output.find(item => item.type === 'chunk' && item.isEntry).code;
const css = output.filter(item => item.type === 'asset' && item.fileName.endsWith('.css')).map(item => String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g, '');
const now = Date.now(), before = new Date(now-60_000).toISOString(), after = new Date(now+86_400_000).toISOString();
const paid = { status:'active',verifiedBy:'square_api',squareSubscriptionId:'base',squareVerifiedAt:before,currentPeriodEnd:after };
const scenarios = [
  { name:'no record', record:null, free:true, transfers:1 },
  { name:'expired paid and addon', record:{...paid,plan:'cloud-17',currentPeriodEnd:before,extraTransfersAddon:true}, free:true, transfers:1 },
  { name:'starter unverified addon', record:{...paid,plan:'cloud-7',extraTransfersAddon:true}, transfers:1 },
  { name:'daily no addon', record:{...paid,plan:'cloud-17'}, transfers:3 },
  { name:'starter verified addon', record:{...paid,plan:'cloud-7',extraTransfersAddon:true,addonStatus:'active',addonVerifiedBy:'square_api',squareAddonSubscriptionId:'addon',addonVerifiedAt:before,addonCurrentPeriodEnd:after}, transfers:3 },
];
const results = [], browser = await chromium.launch({headless:true});
try {
  for (const scenario of scenarios) {
    const page=await browser.newPage({viewport:{width:1280,height:900}});
    page.setDefaultTimeout(10_000);
    const errors=[],checkoutBodies=[]; page.on('pageerror', error=>errors.push(error.message));
    const handler=createMeHandler({authenticate:async()=>({id:'quota-fixture',cloudVersion:'supabase'}),subscription:async()=>scenario.record,clock:()=>now,
      authConfig:async()=>({versions:{supabase:{available:true},aws:{available:false}}}),squareStatus:()=>({ready:true,missing:[]})});
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      assert.equal(url.origin,'https://portabase.fixture.test');
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div class="pb-console"><main class="pb-main"><div class="pb-body" id="root"></div></main></div></body></html>'});
      if(url.pathname==='/api/cloud/subscribe'){
        assert.equal(request.method(),'POST'); assert.match(request.headers().authorization,/^Bearer fixture\./);
        checkoutBodies.push(request.postDataJSON());
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,pending:true})});
      }
      assert.equal(url.pathname,'/api/cloud/me'); assert.equal(request.method(),'GET'); assert.match(request.headers().authorization,/^Bearer fixture\./);
      const response=await handler({httpMethod:'GET'});
      return route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
    });
    await page.goto('https://portabase.fixture.test/'); await page.addStyleTag({content:css}); await page.addScriptTag({content:bundle});
    const dashboard=page.getByRole('region',{name:'Dashboard fixture'}), billing=page.getByRole('region',{name:'Billing fixture'});
    await billing.getByText('Plan · Square',{exact:true}).waitFor();
    const expected=`${scenario.transfers} ${scenario.free?'manual backup':'transfers'} / 24h`;
    assert.ok((await dashboard.locator('.pb-account-strip').innerText()).includes(expected),scenario.name);
    assert.equal(await billing.getByText(expected,{exact:true}).count(),1,scenario.name);
    const panel=await billing.getByText(/Plan allowance:/).innerText();
    assert.ok(panel.includes(`Plan allowance: ${scenario.transfers}`),scenario.name);
    if(scenario.free){
      assert.ok(panel.includes('manual backup')); assert.ok(panel.includes('No scheduled service.'));
      assert.equal(await dashboard.getByRole('button',{name:'Extra transfers',exact:true}).count(),0);
      await dashboard.getByRole('button',{name:'Start trial · $17/mo',exact:true}).click();
      await billing.getByRole('button',{name:/Starter Escape.*\$7/}).click();
      await billing.getByRole('button',{name:'Pay with Square · 7-day trial then $7/mo',exact:true}).click();
      await billing.getByRole('button',{name:/Daily Escape.*\$17/}).click();
      await billing.getByRole('button',{name:'Pay with Square · 7-day trial then $17/mo',exact:true}).click();
      await page.waitForFunction(()=>window.checkoutRequests.length===3);
      assert.deepEqual(checkoutBodies,[{planId:'cloud-17'},{planId:'cloud-7'},{planId:'cloud-17'}]);
      assert.equal(await page.evaluate(()=>window.billingWrites),0);
      assert.equal(await billing.getByText('1 manual backup / 24h',{exact:true}).count(),1);
      // Choosing a plan and abandoning checkout cannot write or grant entitlement.
      await billing.getByRole('button',{name:/Starter Escape.*\$7/}).click();
      assert.equal(checkoutBodies.length,3);
      await page.reload(); await page.addStyleTag({content:css}); await page.addScriptTag({content:bundle});
      await billing.getByText('1 manual backup / 24h',{exact:true}).waitFor();
      assert.equal(await billing.getByText('No scheduled service',{exact:true}).count(),1);
      assert.equal(await page.evaluate(()=>window.billingWrites),0);
      assert.equal(checkoutBodies.length,3);
    }
    assert.deepEqual(errors,[]); results.push({scenario:scenario.name,passed:true}); await page.close();
  }
} finally {await browser.close();}
console.log(JSON.stringify({results,realProviderRequests:0},null,2));
