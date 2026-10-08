import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createMeHandler } from '../netlify/functions/cloud-me.mjs';
import { createDashboardHandler } from '../netlify/functions/cloud-dashboard.mjs';

// Full console and API client, synthetic auth and intercepted HTTP only.
const auth = `
 import {loadSession,clearSession} from '/src/lib/session.js';
 export async function ensureFreshSession(){return loadSession()}
 export async function signOut(){clearSession()}
 export function describeAuthError(error){return error.message}
 const unused=async()=>{throw new Error('Unexpected authentication request')};
 export {unused as signUpWithEmail,unused as completeOAuthCallback,unused as signInWithEmail,unused as signInWithGoogle,unused as signInWithGitHub,unused as signInWithMagicLink,unused as resendSignupEmail,unused as requestPasswordReset,unused as completeGoogleRedirectSignIn};
`;
const compiled = await build({ root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',define:{'process.env.NODE_ENV':'"production"'},
  plugins:[{name:'pending-checkout-auth-fixture',enforce:'pre',resolveId(id){if(id.endsWith('/supabase-auth.js'))return '\0checkout-auth';},load(id){if(id==='\0checkout-auth')return auth;}}],
  build:{write:false,minify:false,lib:{entry:'src/main.jsx',formats:['es'],fileName:'fixture'}},
});
const output=(Array.isArray(compiled)?compiled:[compiled]).flatMap(item=>item.output);
const entry=output.find(item=>item.type==='chunk'&&item.isEntry).fileName;
const assets=new Map(output.map(item=>[item.fileName,item]));
const css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g,'');
const user={id:'checkout-fixture',cloudVersion:'supabase',email:'checkout@example.test'};
const me=createMeHandler({authenticate:async()=>user,subscription:async()=>null,authConfig:async()=>({versions:{supabase:{available:true},aws:{available:false}}}),squareStatus:()=>({ready:true,missing:[]})});
const dashboard=createDashboardHandler({authenticate:async()=>user,jobsDatabase:()=>({get:async()=>[]}),subscription:async()=>null,squareStatus:()=>({ready:true,missing:[]})});
const browser=await chromium.launch({headless:true});
const requests=[],errors=[];
let reply={status:202,body:{ok:false,pending:true}}, release=null;
try {
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.setDefaultTimeout(15_000);page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('portabase.auth.v1',JSON.stringify({provider:'supabase',cloudVersion:'supabase',accessToken:'synthetic-fixture',user:{id:'checkout-fixture',email:'checkout@example.test'}})));
  await page.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url());
    assert.equal(url.origin,'https://portabase.fixture.test','External provider requests are forbidden');
    if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/${entry}"></script></body></html>`});
    if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
    if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});
    const asset=assets.get(url.pathname.slice(1));
    if(asset)return route.fulfill({contentType:asset.type==='chunk'?'text/javascript':'application/octet-stream',body:asset.type==='chunk'?asset.code:String(asset.source)});
    const event={httpMethod:request.method(),headers:request.headers()};let response;
    if(url.pathname==='/api/cloud/me')response=await me(event);
    else if(url.pathname==='/api/cloud/dashboard')response=await dashboard(event);
    else if(url.pathname==='/api/cloud/telemetry-events')response={statusCode:200,body:JSON.stringify({events:[]})};
    else if(url.pathname==='/api/cloud/confirm-checkout'){
      requests.push(request.postDataJSON());
      if(release)await release;
      response={statusCode:reply.status,body:JSON.stringify(reply.body)};
    } else throw new Error(`Unexpected request (new checkout forbidden): ${url.pathname}`);
    return route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
  });
  await page.goto('https://portabase.fixture.test/app?version=supabase&checkout=complete&attempt=existing-checkout');
  const panel=page.getByRole('region',{name:'Checkout confirmation'});
  await panel.getByText('Checkout confirmation pending',{exact:true}).waitFor();
  await page.waitForTimeout(3400);assert.equal(await panel.isVisible(),true);
  await page.locator('.pb-nav').getByRole('button',{name:'Account',exact:true}).click();
  assert.equal(new URL(page.url()).searchParams.get('attempt'),'existing-checkout');
  await page.reload();await panel.getByText('Checkout confirmation pending',{exact:true}).waitFor();
  assert.equal(requests.length,2);
  // A pending checkout cannot create another purchase, even via the billing tab.
  await page.getByRole('button',{name:'Plan',exact:true}).click();
  const pay=page.getByRole('button',{name:/Pay with Square/}).first();
  await pay.waitFor();await pay.click();
  assert.equal(requests.length,2);
  reply={status:503,body:{error:'billing_verification_unavailable'}};
  await panel.getByRole('button',{name:'Check again',exact:true}).click();
  await panel.getByText('Checkout confirmation unavailable',{exact:true}).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('checkout'),'complete');
  reply={status:200,body:{ok:true,access:{hasAccess:false}}};
  await panel.getByRole('button',{name:'Check again',exact:true}).click();
  await panel.getByText(/subscription access is not active/).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('attempt'),'existing-checkout');
  let resolve;release=new Promise(done=>{resolve=done;});
  reply={status:200,body:{ok:true,access:{hasAccess:true,status:'active'},subscription:{plan:'cloud-7',status:'active'}}};
  await panel.getByRole('button',{name:'Check again',exact:true}).click();
  assert.equal(await panel.getByRole('button',{name:'Checking checkout…',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>document.querySelector('[aria-label="Checkout confirmation"]')?.getAttribute('aria-busy')==='true');
  resolve();
  await panel.getByText('Checkout verified',{exact:true}).waitFor();
  await page.waitForURL(url=>!url.searchParams.has('checkout'));
  assert.equal(requests.length,5);
  assert.ok(requests.every(body=>body.attempt==='existing-checkout'&&body.addon===null));
  await page.addInitScript(()=>localStorage.removeItem('portabase.auth.v1'));
  await page.goto('https://portabase.fixture.test/app?version=supabase&checkout=complete&attempt=original-after-login&addon=extra-transfers');
  await page.waitForURL(url=>url.pathname==='/login');
  assert.equal(new URL(page.url()).searchParams.get('next'),'/app?version=supabase&checkout=complete&attempt=original-after-login&addon=extra-transfers');
  assert.equal(requests.length,5);
  assert.deepEqual(errors,[]);
} finally { await browser.close(); }
console.log(JSON.stringify({passed:true,confirmationRequests:requests.length,newCheckouts:0,realMessagesSent:0,realCharges:0},null,2));
