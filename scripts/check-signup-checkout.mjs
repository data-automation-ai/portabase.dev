import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { createMeHandler } from '../netlify/functions/cloud-me.mjs';
import { createDashboardHandler } from '../netlify/functions/cloud-dashboard.mjs';
import { createCancellationHandler } from '../netlify/functions/cloud-cancel-subscription.mjs';

// Actual public app, Supabase adapter/SDK, signup HTTP payload, callback and
// console. Every HTTP request is intercepted with synthetic responses. Checkout
// deliberately stops before provider contact and never grants paid access.
const compiled = await build({ root:fileURLToPath(new URL('..',import.meta.url)),logLevel:'error',define:{
  'process.env.NODE_ENV':'"production"',
  'import.meta.env.VITE_SUPABASE_URL':'"https://auth.fixture.test"',
  'import.meta.env.VITE_SUPABASE_ANON_KEY':'"fixture-public-key"',
},
  build:{write:false,minify:false,lib:{entry:'src/main.jsx',formats:['es'],fileName:'fixture'}},
});
const output=(Array.isArray(compiled)?compiled:[compiled]).flatMap(item=>item.output);
const entry=output.find(item=>item.type==='chunk'&&item.isEntry).fileName;
const assets=new Map(output.map(item=>[item.fileName,item]));
const css=output.filter(item=>item.type==='asset'&&item.fileName.endsWith('.css')).map(item=>String(item.source)).join('\n').replace(/@import\s+url\([^)]*\);?/g,'');
const user={id:'signup-fixture',cloudVersion:'supabase',email:'signup@example.test'};
let subscriptionRecord=null,providerCanceled=false;
const periodEnd='2026-11-01T00:00:00.000Z';
const me=createMeHandler({authenticate:async()=>user,subscription:async()=>subscriptionRecord,authConfig:async()=>({versions:{supabase:{available:true},aws:{available:false}}}),squareStatus:()=>({ready:true,missing:[]})});
const dashboard=createDashboardHandler({authenticate:async()=>user,jobsDatabase:()=>({get:async()=>[]}),subscription:async()=>null,squareStatus:()=>({ready:true,missing:[]})});
const cancellation=createCancellationHandler({authenticate:async()=>user,subscription:async()=>structuredClone(subscriptionRecord),clock:()=>Date.parse('2026-10-05T12:00:00Z'),
  verify:async record=>({verified:true,patch:{squareSubscriptionId:record.squareSubscriptionId,status:'active',currentPeriodEnd:periodEnd,
    cancellationEffectiveAt:providerCanceled?periodEnd:null,verifiedBy:'square_api',squareVerifiedAt:'2026-10-05T12:00:00.000Z'}}),
  cancel:async()=>{providerCanceled=true;},save:async record=>{subscriptionRecord={...record,revision:(record.revision||0)+1};return subscriptionRecord;}});
const browser=await chromium.launch({headless:true}),results=[];
try{
  for(const plan of ['cloud-7','cloud-17']){
    subscriptionRecord=null;providerCanceled=false;
    const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[],checkout=[],signupRedirects=[],resendRedirects=[],cancellationBodies=[];
    let failFirstCancellation=true;
    page.setDefaultTimeout(15_000);page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin==='https://auth.fixture.test'){
        const authUser={id:'signup-fixture',email:'signup@example.test',aud:'authenticated',role:'authenticated',created_at:new Date().toISOString(),identities:[{id:'fixture-identity',provider:'email'}]};
        let body;
        if(url.pathname==='/auth/v1/signup'){
          assert.equal(request.method(),'POST');signupRedirects.push(url.searchParams.get('redirect_to'));
          const input=request.postDataJSON();assert.equal(input.email,'signup@example.test');assert.ok(input.code_challenge);
          body=authUser;
        }else if(url.pathname==='/auth/v1/resend'){
          assert.equal(request.method(),'POST');resendRedirects.push(url.searchParams.get('redirect_to'));body={};
        }else if(url.pathname==='/auth/v1/token'){
          assert.equal(url.searchParams.get('grant_type'),'pkce');assert.ok(request.postDataJSON().code_verifier);
          const payload=Buffer.from(JSON.stringify({sub:authUser.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url');
          body={access_token:`fixture.${payload}.fixture`,refresh_token:'fixture-refresh',expires_in:3600,token_type:'bearer',user:authUser};
        }else throw new Error(`Unexpected auth fixture request ${url.pathname}`);
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
      }
      assert.equal(url.origin,'https://portabase.fixture.test','External requests are forbidden');
      if(request.isNavigationRequest())return route.fulfill({contentType:'text/html',body:`<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/${entry}"></script></body></html>`});
      if(url.pathname==='/fixture.css')return route.fulfill({contentType:'text/css',body:css});
      if(request.resourceType()==='image')return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'});
      const asset=assets.get(url.pathname.slice(1));
      if(asset)return route.fulfill({contentType:asset.type==='chunk'?'text/javascript':'application/octet-stream',body:asset.type==='chunk'?asset.code:String(asset.source)});
      const event={httpMethod:request.method(),headers:request.headers()};let response;
      if(url.pathname==='/api/cloud/me')response=await me(event);
      else if(url.pathname==='/api/cloud/dashboard')response=await dashboard(event);
      else if(url.pathname==='/api/cloud/telemetry-events')response={statusCode:200,body:JSON.stringify({events:[]})};
      else if(url.pathname==='/api/cloud/subscribe'){
        assert.equal(request.method(),'POST');assert.match(request.headers().authorization,/^Bearer fixture\./);
        checkout.push(request.postDataJSON());response={statusCode:503,body:JSON.stringify({error:'fixture_checkout_canceled',message:'Fixture checkout canceled before provider contact.'})};
      }else if(url.pathname==='/api/cloud/cancel-subscription'){
        assert.equal(request.method(),'POST');assert.match(request.headers().authorization,/^Bearer fixture\./);
        cancellationBodies.push(request.postDataJSON());
        if(failFirstCancellation){failFirstCancellation=false;response={statusCode:503,body:JSON.stringify({error:'cancellation_reconciliation_required',message:'Cancellation could not be fully confirmed. Refresh and retry to check its current status.'})};}
        else {
          const accepted=await cancellation({httpMethod:request.method(),headers:request.headers(),body:request.postData()});
          assert.equal(accepted.statusCode,200);
          // Model a lost successful response. The browser must reconcile from
          // the provider-backed account read instead of announcing failure or
          // sending a third cancellation mutation.
          response={statusCode:503,body:JSON.stringify({error:'cancellation_reconciliation_required',providerMayHaveChanged:true,message:'Cancellation could not be fully confirmed. Refresh and retry to check its current status.'})};
        }
      }else throw new Error(`Unexpected fixture request ${url.pathname}`);
      return route.fulfill({status:response.statusCode,contentType:'application/json',body:response.body});
    });
    await page.goto('https://portabase.fixture.test/signup');
    await page.getByRole('heading',{name:'Create your Cloud account',exact:true}).waitFor();
    await page.goto('https://portabase.fixture.test/signup?mode=signin');
    await page.getByRole('heading',{name:'Sign in to Cloud',exact:true}).waitFor();
    await page.goto('https://portabase.fixture.test/cloud');
    const card=page.locator('.plan-card').filter({hasText:plan==='cloud-7'?'STARTER ESCAPE':'DAILY ESCAPE'});
    const wanted=`/app/account?tab=billing&plan=${plan}`;
    const link=card.getByRole('link',{name:/Sign in · pick this plan/});
    assert.equal(new URL(await link.getAttribute('href'),'https://portabase.fixture.test').searchParams.get('next'),wanted);
    await link.click();await page.getByRole('heading',{name:'Create your Cloud account',exact:true}).waitFor();
    for(const checkbox of await page.getByRole('checkbox').all())await checkbox.check();
    await page.getByLabel('Work email',{exact:true}).fill('signup@example.test');
    await page.locator('#auth-password').fill('Synthetic-fixture-password');
    await page.getByRole('button',{name:'Create account',exact:true}).click();
    await page.getByRole('button',{name:'Resend confirmation email',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('portabase.auth.next')),wanted);
    assert.equal(signupRedirects.length,1);
    const callback=new URL(signupRedirects[0]);
    assert.equal(callback.origin,'https://portabase.fixture.test');assert.equal(callback.pathname,'/auth/callback');
    assert.equal(callback.searchParams.get('version'),'supabase');assert.equal(callback.searchParams.get('next'),wanted);
    await page.getByRole('button',{name:'Resend confirmation email',exact:true}).click();
    await page.getByText('Confirmation email resent.',{exact:true}).waitFor();
    assert.deepEqual(resendRedirects,signupRedirects);
    // A fresh tab session loses sessionStorage; the existing PKCE verifier remains
    // in browser localStorage. The link itself must carry the validated choice.
    await page.evaluate(()=>sessionStorage.clear());
    callback.searchParams.set('code','fixture');
    await page.goto(callback.toString());
    await page.waitForURL(url=>url.pathname==='/app/account'&&url.searchParams.get('plan')===plan);
    const price=plan==='cloud-7'?7:17;
    const pay=page.getByRole('button',{name:`Pay with Square · 7-day trial then $${price}/mo`,exact:true});
    await pay.waitFor();await page.getByText('1 manual backup / 24h',{exact:true}).waitFor();
    await pay.click();await page.getByText('Fixture checkout canceled before provider contact.',{exact:true}).waitFor();
    assert.deepEqual(checkout,[{planId:plan}]);
    await page.reload();await pay.waitFor();await page.getByText('1 manual backup / 24h',{exact:true}).waitFor();
    assert.equal(await page.getByText('No scheduled service',{exact:true}).count(),1);
    // An already-signed-in visitor keeps the chosen next route too.
    await page.goto(`https://portabase.fixture.test/login?mode=signup&next=${encodeURIComponent(wanted)}`);
    const next=page.getByRole('link',{name:'Continue to your account',exact:true});await next.waitFor();
    assert.equal(new URL(await next.getAttribute('href'),'https://portabase.fixture.test').searchParams.get('plan'),plan);
    await next.click();await pay.waitFor();
    // A tampered email return cannot navigate off-site even after authentication.
    for(const unsafe of ['//evil.example/path','/%255cevil.example','/app%0A']){
      await page.evaluate(()=>sessionStorage.clear());
      await page.goto(`https://portabase.fixture.test/auth/callback?version=supabase&next=${encodeURIComponent(unsafe)}`);
      await page.waitForURL(url=>url.pathname==='/dashboard');
      assert.equal(new URL(page.url()).origin,'https://portabase.fixture.test');
    }
    subscriptionRecord={userId:'supabase:signup-fixture',checkoutAttempt:'paid-attempt',squareOrderId:'paid-order',squareSubscriptionId:'paid-base',
      status:'active',plan,currentPeriodEnd:periodEnd,verifiedBy:'square_api',squareVerifiedAt:'2026-10-05T12:00:00.000Z',revision:1};
    await page.goto('https://portabase.fixture.test/app/account?tab=billing');
    const cancelRenewal=page.getByRole('button',{name:'Cancel renewal',exact:true});await cancelRenewal.waitFor();await cancelRenewal.click();
    await page.getByRole('heading',{name:'Cancel subscription renewal?',exact:true}).waitFor();
    await page.getByText('This does not issue a refund or end verified access before the current paid period expires.',{exact:false}).waitFor();
    assert.deepEqual(cancellationBodies,[]);
    await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
    await page.getByRole('alert').getByText('Cancellation not confirmed',{exact:true}).waitFor();
    assert.deepEqual(cancellationBodies,[{confirm:true}]);
    assert.equal(await page.getByText('Renewal canceled',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Confirm cancellation',exact:true}).click();
    await page.getByText('Renewal canceled',{exact:true}).waitFor();
    await page.getByText('Square confirms access through Nov 1, 2026.',{exact:false}).waitFor();
    assert.deepEqual(cancellationBodies,[{confirm:true},{confirm:true}]);
    assert.equal(await cancelRenewal.count(),0);
    assert.deepEqual(errors,[]);results.push({plan,passed:true,checkoutRequests:checkout.length,cancellationRequests:cancellationBodies.length});await page.close();
  }
}finally{await browser.close();}
console.log(JSON.stringify({results,realAccountsCreated:0,realMessagesSent:0,realCharges:0},null,2));
