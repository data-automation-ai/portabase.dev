import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import path from 'node:path';
const browser=await chromium.launch();
try{
  const page=await browser.newPage({viewport:{width:1362,height:844}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:4197');
  const status=async()=>await (await page.request.get('http://127.0.0.1:4197/status')).json();
  const openScope=async()=>{
    await page.getByRole('button',{name:'Select database objects',exact:true}).click();
    await page.getByRole('button',{name:'All Structure Only',exact:true}).first().waitFor();
  };
  await openScope();
  await page.getByRole('button',{name:'All Structure Only',exact:true}).first().click();
  await Promise.all([page.waitForResponse(r=>r.url().endsWith('/scope')&&r.request().method()==='POST'),
    page.getByRole('button',{name:'Save & Close',exact:true}).click()]);
  await page.locator('dialog[open]').waitFor({state:'hidden'});
  assert.deepEqual((await status()).scope.tables,[]);
  await openScope();
  assert.match(await page.locator('dialog').innerText(),/1 Structure Only/);
  await page.getByRole('button',{name:'Select All (Structure + Data)',exact:true}).click();
  await page.getByRole('button',{name:'Save selection',exact:true}).click();
  await page.locator('dialog[open]').waitFor({state:'hidden'});
  assert.deepEqual((await status()).scope.tables,['public.orders']);
  await openScope();await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.locator('dialog[open]').waitFor({state:'hidden'});
  const source=page.locator('.connection').first(),target=page.locator('.connection').last();
  await source.locator('select[name="ref"]').selectOption('source-second');
  await page.waitForFunction(()=>document.querySelector('.connection select[name="ref"]').value==='source-second');
  await page.waitForLoadState('networkidle');
  assert.equal((await status()).selection.source,'source-second');
  await source.locator('.multi-project-picker summary').click();
  await source.locator('input[name="sourceRefs"][value="source-demo"]').check();
  await source.locator('select[name="targetFor_source-demo"]').selectOption('target-second');
  await source.getByRole('button',{name:'Apply Multi-Project Selection',exact:true}).click();
  await page.waitForLoadState('networkidle');
  assert.equal((await status()).selection.targetMap['source-demo'],'target-second');
  await source.locator('.multi-project-picker summary').click();
  assert.equal(await source.locator('select[name="targetFor_source-demo"]').inputValue(),'target-second');
  await source.locator('.multi-project-picker summary').click();
  await target.locator('input[name="allowOverwrite"]').check();
  await page.waitForLoadState('networkidle');
  assert.equal((await status()).allowOverwrite,true);
  // Provider actions: inspect actual browser submission without contacting a provider.
  const posts=[];
  await page.route('**/reauthorize',async route=>{posts.push(new URLSearchParams(route.request().postData()));await route.fulfill({status:200,body:'Intercepted for UI verification'});});
  await source.getByText('Source connection settings',{exact:true}).click();
  await source.getByRole('button',{name:'Authorize a different source account',exact:true}).click();
  await page.waitForLoadState('networkidle');assert.equal(posts[0].get('slot'),'source');assert.ok(posts[0].get('nonce'));
  await page.goto('http://127.0.0.1:4197');
  await target.locator('summary').filter({hasText:'Destination connection settings'}).click();
  await target.getByRole('button',{name:'Authorize a different target account',exact:true}).click();
  await page.waitForLoadState('networkidle');assert.equal(posts[1].get('slot'),'target');
  // Leave the review surface in a conservative, predictable sample state.
  await page.request.post('http://127.0.0.1:4197/select',{form:{nonce:'preview-only',slot:'target',ref:'target-demo'}});
  await page.goto('http://127.0.0.1:4197');
  for(const width of [1362,768,390]){
    await page.setViewportSize({width,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`Overflow at ${width}`);
    await page.screenshot({path:path.join(tmpdir(),`portabase-refined-${width}.png`),fullPage:true});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: both save buttons, reopen persistence, cancel, project selection, batch mapping persistence, overwrite selection, both account-switch payloads, 3 viewport widths. Provider calls intercepted.');
}finally{await browser.close();}
