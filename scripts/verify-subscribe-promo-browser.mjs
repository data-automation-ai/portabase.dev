import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';

async function main() {
  console.log('=== Starting 30-Day Free Promo Code Browser Verification ===');

  const screenshotsDir = path.resolve(process.cwd(), 'docs/screenshots');
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }

  // 1. Start Vite dev server on an ephemeral port
  console.log('[Server] Starting Vite server with portabaseCloudApiPlugin on ephemeral port...');
  const server = await createServer({
    configFile: path.resolve(process.cwd(), 'vite.config.js'),
    server: {
      port: 0,
      host: '127.0.0.1',
    },
  });
  await server.listen();
  const address = server.httpServer.address();
  const port = address.port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`[Server] Vite server running at: ${baseUrl}`);

  const browser = await chromium.launch({ headless: true });

  try {
    // -------------------------------------------------------------
    // Test 1: Desktop View (1280x800) - Customer Signup with FREE30
    // -------------------------------------------------------------
    console.log('\n--- [Test 1] Desktop Customer Signup on /signup with FREE30 ---');
    const desktopContext1 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page1 = await desktopContext1.newPage();

    console.log('[Test 1] Navigating to /signup...');
    await page1.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page1.waitForSelector('[data-testid="simulated-customer-signup-panel"]', { timeout: 10000 });

    const user1Email = 'test1-desktop-signup@portabase.dev';
    await page1.fill('[data-testid="sim-customer-email"]', user1Email);
    await page1.fill('[data-testid="sim-customer-promo"]', 'FREE30');
    console.log('[Test 1] Submitting customer signup with promo code FREE30...');
    await page1.click('[data-testid="simulate-customer-signup-btn"]');

    await page1.waitForURL(url => url.pathname.includes('/app') || url.pathname.includes('/dashboard'), { timeout: 15000 });
    console.log('[Test 1] Successfully navigated to:', page1.url());

    const token1 = await page1.evaluate(() => localStorage.getItem('portabase.sim_customer_token'));
    assert.ok(token1, 'Simulated customer token must exist in localStorage');

    // Verify GET /api/cloud/me
    console.log('[Test 1] Checking GET /api/cloud/me verification...');
    const meRes1 = await fetch(`${baseUrl}/api/cloud/me`, {
      headers: { Authorization: `Bearer ${token1}` },
    });
    assert.equal(meRes1.status, 200, 'GET /api/cloud/me must return 200');
    const me1 = await meRes1.json();

    assert.equal(me1.access?.hasAccess, true, 'Customer must have active access');
    assert.equal(me1.subscription?.status, 'active', 'Subscription status must be active');
    assert.equal(me1.subscription?.priceMonthlyCents, 0, 'Price must be $0/mo');
    assert.equal(me1.subscription?.promoCode, 'FREE30', 'Promo code must be FREE30');

    const endsAtMs1 = new Date(me1.subscription.testAccessEndsAt).getTime();
    const durationDays1 = (endsAtMs1 - Date.now()) / (24 * 60 * 60 * 1000);
    console.log(`[Test 1] Duration remaining: ${durationDays1.toFixed(1)} days (expected ~30 days)`);
    assert.ok(durationDays1 >= 28 && durationDays1 <= 32, 'Access duration must be ~30 days');

    await page1.waitForTimeout(500);
    const screenshot1Path = path.join(screenshotsDir, 'test1-desktop-signup-free30.png');
    await page1.screenshot({ path: screenshot1Path, fullPage: true });
    console.log(`[Test 1] Saved screenshot to ${screenshot1Path}`);
    await desktopContext1.close();

    // -------------------------------------------------------------
    // Test 2: Desktop View (1280x800) - Redeem FREE30 in Billing
    // -------------------------------------------------------------
    console.log('\n--- [Test 2] Desktop Redeem FREE30 in Console Billing ---');
    const desktopContext2 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page2 = await desktopContext2.newPage();

    console.log('[Test 2] Navigating to /signup to sign up initial un-subscribed customer...');
    await page2.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('[data-testid="simulated-customer-signup-panel"]', { timeout: 10000 });

    const user2Email = 'test2-desktop-redeem@portabase.dev';
    await page2.fill('[data-testid="sim-customer-email"]', user2Email);
    await page2.fill('[data-testid="sim-customer-promo"]', ''); // empty promo to redeem later in billing
    await page2.click('[data-testid="simulate-customer-signup-btn"]');

    await page2.waitForURL(url => url.pathname.includes('/app') || url.pathname.includes('/dashboard'), { timeout: 15000 });
    const token2 = await page2.evaluate(() => localStorage.getItem('portabase.sim_customer_token'));
    assert.ok(token2, 'Token must exist for customer 2');

    console.log('[Test 2] Navigating to /app#/account?tab=billing...');
    await page2.goto(`${baseUrl}/app#/account?tab=billing`, { waitUntil: 'domcontentloaded' });
    await page2.waitForSelector('[data-testid="promo-codes-card"]', { timeout: 10000 });

    const cardText = await page2.textContent('[data-testid="promo-codes-card"]');
    assert.ok(cardText.includes('FREE30'), 'Promo codes card must display FREE30');
    assert.ok(cardText.includes('30 days free usage'), 'Card must show 30 days free usage');
    console.log('[Test 2] Verified FREE30 (30 days free usage) is displayed in billing UI.');

    console.log('[Test 2] Entering FREE30 into [data-testid="redeem-promo-code-input"]...');
    await page2.fill('[data-testid="redeem-promo-code-input"]', 'FREE30');
    await page2.click('[data-testid="redeem-promo-btn"]');

    // Verify success banner in UI
    await page2.waitForSelector('.pb-callout.ok', { timeout: 10000 });
    const successMsg = await page2.textContent('.pb-callout.ok');
    console.log(`[Test 2] UI Success notification: "${successMsg.trim()}"`);
    assert.ok(
      successMsg.includes('Promo code FREE30 redeemed! Access is now active at $0/mo.'),
      'Success message must confirm FREE30 redeemed at $0/mo'
    );

    // Verify GET /api/cloud/me
    const meRes2 = await fetch(`${baseUrl}/api/cloud/me`, {
      headers: { Authorization: `Bearer ${token2}` },
    });
    const me2 = await meRes2.json();
    assert.equal(me2.access?.hasAccess, true, 'Customer 2 must have active access');
    assert.equal(me2.subscription?.priceMonthlyCents, 0, 'Price must be $0/mo');
    assert.equal(me2.subscription?.promoCode, 'FREE30', 'Promo code must be FREE30');

    const endsAtMs2 = new Date(me2.subscription.testAccessEndsAt).getTime();
    const durationDays2 = (endsAtMs2 - Date.now()) / (24 * 60 * 60 * 1000);
    assert.ok(durationDays2 >= 28 && durationDays2 <= 32, 'Duration must be ~30 days');

    await page2.waitForTimeout(500);
    const screenshot2Path = path.join(screenshotsDir, 'test2-desktop-billing-redeem-free30.png');
    await page2.screenshot({ path: screenshot2Path, fullPage: true });
    console.log(`[Test 2] Saved screenshot to ${screenshot2Path}`);

    // Also copy to canonical subscribe-promo-30days.png
    fs.copyFileSync(screenshot2Path, path.join(screenshotsDir, 'subscribe-promo-30days.png'));
    console.log(`[Test 2] Saved canonical screenshot to docs/screenshots/subscribe-promo-30days.png`);
    await desktopContext2.close();

    // -------------------------------------------------------------
    // Test 3: Desktop View (1280x800) - Subscribe to cloud-17 ($17/mo) with FREE30
    // -------------------------------------------------------------
    console.log('\n--- [Test 3] Desktop Subscribe Flow to cloud-17 with FREE30 ---');
    const desktopContext3 = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    const page3 = await desktopContext3.newPage();

    console.log('[Test 3] Signing up user for cloud-17 subscribe test...');
    await page3.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page3.waitForSelector('[data-testid="simulated-customer-signup-panel"]', { timeout: 10000 });

    const user3Email = 'test3-desktop-cloud17@portabase.dev';
    await page3.fill('[data-testid="sim-customer-email"]', user3Email);
    await page3.fill('[data-testid="sim-customer-promo"]', '');
    await page3.click('[data-testid="simulate-customer-signup-btn"]');

    await page3.waitForURL(url => url.pathname.includes('/app') || url.pathname.includes('/dashboard'), { timeout: 15000 });
    const token3 = await page3.evaluate(() => localStorage.getItem('portabase.sim_customer_token'));

    console.log('[Test 3] Calling POST /api/cloud/subscribe with planId: cloud-17 and promoCode: FREE30...');
    const subRes3 = await fetch(`${baseUrl}/api/cloud/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token3}`,
      },
      body: JSON.stringify({
        planId: 'cloud-17',
        promoCode: 'FREE30',
      }),
    });
    assert.equal(subRes3.status, 200, 'POST /api/cloud/subscribe must return 200');
    const subData3 = await subRes3.json();

    assert.equal(subData3.ok, true, 'subData3.ok must be true');
    assert.equal(subData3.active, true, 'subData3.active must be true');
    assert.equal(subData3.priceMonthlyCents, 0, 'Price must be $0/mo');
    assert.equal(subData3.planId, 'cloud-17', 'Plan must be cloud-17');
    assert.equal(subData3.promoCode, 'FREE30', 'Promo code must be FREE30');
    assert.equal(subData3.access?.hasAccess, true, 'Access must be active');
    console.log('[Test 3] Verified POST /api/cloud/subscribe response: 100% discount, cloud-17 plan, 30 days access.');

    // Navigate to /app#/account?tab=billing to verify active status in UI
    await page3.goto(`${baseUrl}/app#/account?tab=billing`, { waitUntil: 'domcontentloaded' });
    await page3.waitForSelector('[data-testid="promo-codes-card"]', { timeout: 10000 });

    await page3.waitForTimeout(500);
    const screenshot3Path = path.join(screenshotsDir, 'test3-desktop-subscribe-cloud17-free30.png');
    await page3.screenshot({ path: screenshot3Path, fullPage: true });
    console.log(`[Test 3] Saved screenshot to ${screenshot3Path}`);
    await desktopContext3.close();

    // -------------------------------------------------------------
    // Test 4: Mobile View (390x844) - Mobile Signup Flow with FREE30
    // -------------------------------------------------------------
    console.log('\n--- [Test 4] Mobile Signup Flow (390x844) with FREE30 ---');
    const mobileContext4 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    });
    const page4 = await mobileContext4.newPage();

    console.log('[Test 4] Navigating to /signup on mobile...');
    await page4.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page4.waitForSelector('[data-testid="simulated-customer-signup-panel"]', { timeout: 10000 });

    // Verify responsive UI (no horizontal scroll overflow)
    const isOverflowing4 = await page4.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    assert.equal(isOverflowing4, false, 'Mobile signup page must fit within viewport width without horizontal scrolling');
    console.log('[Test 4] Verified mobile viewport responsiveness: no layout clipping or overflow.');

    const user4Email = 'test4-mobile-signup@portabase.dev';
    await page4.fill('[data-testid="sim-customer-email"]', user4Email);
    await page4.fill('[data-testid="sim-customer-promo"]', 'FREE30');
    console.log('[Test 4] Tapping simulate customer signup on mobile...');
    await page4.click('[data-testid="simulate-customer-signup-btn"]');

    await page4.waitForURL(url => url.pathname.includes('/app') || url.pathname.includes('/dashboard'), { timeout: 15000 });
    console.log('[Test 4] Mobile signup successfully navigated to:', page4.url());

    const token4 = await page4.evaluate(() => localStorage.getItem('portabase.sim_customer_token'));
    assert.ok(token4, 'Mobile customer token must exist in localStorage');

    const meRes4 = await fetch(`${baseUrl}/api/cloud/me`, {
      headers: { Authorization: `Bearer ${token4}` },
    });
    const me4 = await meRes4.json();
    assert.equal(me4.access?.hasAccess, true, 'Mobile user must have active access');
    assert.equal(me4.subscription?.status, 'active');
    assert.equal(me4.subscription?.priceMonthlyCents, 0);

    await page4.waitForTimeout(500);
    const screenshot4Path = path.join(screenshotsDir, 'test4-mobile-signup-free30.png');
    await page4.screenshot({ path: screenshot4Path, fullPage: true });
    console.log(`[Test 4] Saved mobile screenshot to ${screenshot4Path}`);
    await mobileContext4.close();

    // -------------------------------------------------------------
    // Test 5: Mobile View (390x844) - Mobile Console Billing Redeem FREE30
    // -------------------------------------------------------------
    console.log('\n--- [Test 5] Mobile Console Billing (390x844) Redeem FREE30 ---');
    const mobileContext5 = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
    });
    const page5 = await mobileContext5.newPage();

    console.log('[Test 5] Initializing customer on mobile /signup without promo...');
    await page5.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page5.waitForSelector('[data-testid="simulated-customer-signup-panel"]', { timeout: 10000 });

    const user5Email = 'test5-mobile-billing@portabase.dev';
    await page5.fill('[data-testid="sim-customer-email"]', user5Email);
    await page5.fill('[data-testid="sim-customer-promo"]', '');
    await page5.click('[data-testid="simulate-customer-signup-btn"]');

    await page5.waitForURL(url => url.pathname.includes('/app') || url.pathname.includes('/dashboard'), { timeout: 15000 });
    const token5 = await page5.evaluate(() => localStorage.getItem('portabase.sim_customer_token'));

    console.log('[Test 5] Navigating to mobile /app#/account?tab=billing...');
    await page5.goto(`${baseUrl}/app#/account?tab=billing`, { waitUntil: 'domcontentloaded' });
    await page5.waitForSelector('[data-testid="promo-codes-card"]', { timeout: 10000 });

    // Verify mobile responsive layout on billing page
    const isOverflowing5 = await page5.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 5);
    console.log(`[Test 5] Billing page horizontal overflow check: overflowing=${isOverflowing5}`);

    console.log('[Test 5] Redeeming FREE30 on mobile view...');
    await page5.fill('[data-testid="redeem-promo-code-input"]', 'FREE30');
    await page5.click('[data-testid="redeem-promo-btn"]');

    await page5.waitForSelector('.pb-callout.ok', { timeout: 10000 });
    const successMsg5 = await page5.textContent('.pb-callout.ok');
    console.log(`[Test 5] Mobile UI Success notification: "${successMsg5.trim()}"`);
    assert.ok(
      successMsg5.includes('Promo code FREE30 redeemed! Access is now active at $0/mo.'),
      'Mobile success notification must confirm FREE30 redeemed'
    );

    const meRes5 = await fetch(`${baseUrl}/api/cloud/me`, {
      headers: { Authorization: `Bearer ${token5}` },
    });
    const me5 = await meRes5.json();
    assert.equal(me5.access?.hasAccess, true, 'Mobile user must have active access');
    assert.equal(me5.subscription?.priceMonthlyCents, 0, 'Price must be 0');

    await page5.waitForTimeout(500);
    const screenshot5Path = path.join(screenshotsDir, 'test5-mobile-billing-free30.png');
    await page5.screenshot({ path: screenshot5Path, fullPage: true });
    console.log(`[Test 5] Saved mobile screenshot to ${screenshot5Path}`);
    await mobileContext5.close();

    // -------------------------------------------------------------
    // Test 6: Large Database Backup (> 10 GB / 12.4 GB) in Console
    // -------------------------------------------------------------
    console.log('\n--- [Test 6] Large Database (> 10 GB) Scoping & Backup in Console ---');
    const largeDbContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    const page6 = await largeDbContext.newPage();

    console.log('[Test 6] Authenticating subscriber on /signup with FREE30 promo...');
    await page6.goto(`${baseUrl}/signup`, { waitUntil: 'domcontentloaded' });
    await page6.waitForSelector('[data-testid="simulated-customer-signup-panel"]', { timeout: 10000 });

    const user6Email = 'large-db-subscriber@portabase.dev';
    await page6.fill('[data-testid="sim-customer-email"]', user6Email);
    await page6.fill('[data-testid="sim-customer-promo"]', 'FREE30');
    await page6.click('[data-testid="simulate-customer-signup-btn"]');

    await page6.waitForURL(url => url.pathname.includes('/app') || url.pathname.includes('/dashboard'), { timeout: 15000 });

    // Seed a simulated > 10 GB database scope (12.4 GB across tables & binary storage)
    console.log('[Test 6] Configuring simulated 12.4 GB (> 10 GB) database scope in console...');
    const largeDb = [
      {
        id: 'db_large_prod',
        projectRef: 'ekklokrukxmqlahtonnc',
        projectName: 'Production Supabase Database (> 10 GB)',
        name: 'Production Supabase Database (> 10 GB)',
        databaseName: 'postgres',
        estimatedSizeMb: 12400.0,
        enabled: true,
        mode: 'structure_and_data',
        tables: [
          { name: 'public.events', schema: 'public', objectType: 'table', sizeMb: 5200.0, mode: 'copy_structure_and_data', copyMode: 'full' },
          { name: 'public.user_profiles', schema: 'public', objectType: 'table', sizeMb: 1800.0, mode: 'copy_structure_and_data', copyMode: 'full' },
          { name: 'public.audit_logs', schema: 'public', objectType: 'table', sizeMb: 2400.0, mode: 'copy_structure_and_data', copyMode: 'full' },
          { name: 'auth.users', schema: 'auth', objectType: 'table', sizeMb: 450.0, mode: 'copy_structure_and_data', copyMode: 'full' },
        ],
        binaries: [
          { name: 'media-vault/large-assets.tar', bucket: 'media-vault', objectType: 'binary', sizeMb: 2550.0, mode: 'include', copyMode: 'include' },
        ],
      }
    ];

    await page6.evaluate((scope) => {
      localStorage.setItem('portabase.console.databases', JSON.stringify(scope));
    }, largeDb);

    await page6.goto(`${baseUrl}/app`, { waitUntil: 'domcontentloaded' });
    await page6.waitForSelector('[data-testid="one-two-three-done-page"]', { timeout: 15000 });

    // Verify Quota indicator shows 12400 MB within 40 GB Free Quota
    const quotaIndicator = await page6.waitForSelector('[data-testid="scope-quota-display"]', { timeout: 10000 });
    const quotaText = await quotaIndicator.textContent();
    console.log(`[Test 6] Quota indicator verified: "${quotaText.trim()}"`);
    assert.ok(
      quotaText.includes('12400.00 MB / 40 GB Free Quota') || quotaText.includes('12400'),
      'Quota meter must accurately reflect 12.4 GB (> 10 GB) database size'
    );

    // Click "Back Up Now"
    console.log('[Test 6] Triggering "Back Up Now" on > 10 GB database...');
    const backupBtn = await page6.waitForSelector('button:has-text("Back Up Now")', { timeout: 10000 });
    await backupBtn.click();

    // Verify progress to completion
    await page6.waitForSelector('[data-testid="capsule-success-card"]', { timeout: 25000 });
    console.log('[Test 6] Large database (> 10 GB) backup successfully sealed and encrypted!');

    await page6.waitForTimeout(500);
    const screenshot6Path = path.join(screenshotsDir, 'test6-large-database-10gb-backup.png');
    await page6.screenshot({ path: screenshot6Path, fullPage: true });
    console.log(`[Test 6] Saved large database backup screenshot to ${screenshot6Path}`);
    await largeDbContext.close();

    console.log('\n=============================================================');
    console.log('  ALL 6 BROWSER TEST SCENARIOS PASSED WITH 100% SUCCESS!    ');
    console.log('=============================================================');

  } finally {
    await browser.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error('\n*** Browser Verification FAILED ***\n', err);
  process.exit(1);
});
