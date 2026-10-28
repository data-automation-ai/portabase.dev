import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveSquareCheckoutReady, inspectSquareCheckoutReady } from '../netlify/shared/square-ready.mjs';
import { createSubscribeHandler } from '../netlify/functions/cloud-subscribe.mjs';
import { createConfirmationHandler } from '../netlify/functions/cloud-confirm-checkout.mjs';
import { rememberCheckout, checkoutForAttempt } from '../netlify/shared/checkout-attempts.mjs';
import { store, withBlobs, deriveAccess } from '../netlify/shared/subscription-store.mjs';
import siteGate from '../netlify/edge-functions/site-gate.js';
import { saveSession, clearSession } from '../src/lib/session.js';

const user = { id: 'user', cloudVersion: 'supabase' };
const event = body => ({ httpMethod: 'POST', body: JSON.stringify(body) });

test('readiness accepts product variables and resolved bundle credentials without exposing values', async () => {
  assert.equal(inspectSquareCheckoutReady({ PORTABASE_SQUARE_ACCESS_TOKEN: 'secret', PORTABASE_SQUARE_LOCATION_ID: 'location' }).ready, true);
  const calls = [];
  const ready = await resolveSquareCheckoutReady({ env: {}, resolve: async (...args) => { calls.push(args); return 'secret-value'; } });
  assert.equal(ready.ready, true);
  assert.deepEqual(calls.map(row => row.slice(0, 2)), [['SQUARE_ACCESS_TOKEN', 'access_token'], ['SQUARE_LOCATION_ID', 'location_id']]);
  assert.ok(!JSON.stringify(ready).includes('secret-value'));
  assert.equal((await resolveSquareCheckoutReady({ env: {}, resolve: async () => { throw Error('private'); } })).ready, false);
});

test('second checkout preserves first order and plan for server-side confirmation', async () => {
  let record, count = 0;
  const subscribe = createSubscribeHandler({ authenticate: async () => user, get: async () => record,
    save: async next => (record = next), credentials: async () => ({ locationId: 'LOC' }),
    ensurePlan: async plan => 'variation-' + plan,
    request: async () => ({ payment_link: { id: 'link-' + ++count, order_id: 'order-' + count, url: 'https://square.example/' + count } }),
    configuration:async()=>({managedStarterEnabled:true,starterVariationId:'approved',usageImageDigest:'sha256:'+'a'.repeat(64)}),authConfig: async () => ({}) });
  const first = JSON.parse((await subscribe(event({ planId: 'cloud-9' }))).body);
  const second = JSON.parse((await subscribe(event({ planId: 'cloud-17' }))).body);
  assert.notEqual(first.attempt, second.attempt);
  let verified;
  const confirm = createConfirmationHandler({ authenticate: async () => user, get: async () => record, reconcile: async candidate => { verified = candidate; return { verified: true, record: candidate }; } });
  assert.equal((await confirm(event({ attempt: first.attempt }))).statusCode, 200);
  assert.equal(verified.squareOrderId, 'order-1');
  assert.equal(verified.squarePaymentLinkId, 'link-1');
  assert.equal(verified.plan, 'cloud-9');
  assert.equal(verified.squarePlanVariationId, 'variation-cloud-9');
  assert.equal((await confirm(event({ attempt: 'foreign-attempt' }))).statusCode, 409);
});

test('different-plan checkout preserves paid access until confirmation; same plan is a no-op', async () => {
  let record = { userId: 'supabase:user', plan: 'cloud-7', status: 'active', verifiedBy: 'square_api', squareSubscriptionId: 'existing-sub', squareVerifiedAt: '2026-01-01T00:00:00Z', currentPeriodEnd: '2099-01-01T00:00:00Z', checkoutAttempt: 'old', squareOrderId: 'old-order' };
  let calls = 0;
  const subscribe = createSubscribeHandler({ authenticate: async () => user, get: async () => record, save: async next => (record = next),
    credentials: async () => ({ locationId: 'LOC' }), ensurePlan: async () => 'new-variation',
    request: async () => { calls++; return { payment_link: { id: 'link', order_id: 'new-order', url: 'https://square.example' } }; }, authConfig: async () => ({}) });
  assert.equal(JSON.parse((await subscribe(event({ planId: 'cloud-7' }))).body).alreadySubscribed, true);
  assert.equal(calls, 0);
  const response = JSON.parse((await subscribe(event({ planId: 'cloud-17' }))).body);
  assert.equal(calls, 1);
  assert.equal(record.plan, 'cloud-7');
  assert.equal(deriveAccess(record).hasAccess, true);
  const candidate = checkoutForAttempt(record, response.attempt);
  assert.equal(candidate.plan, 'cloud-17');
  assert.equal(candidate.squareSubscriptionId, null);
  assert.equal(candidate.squareOrderId, 'new-order');
});

test('attempt history is bounded and closed subscriptions cannot be reopened by an older tab', () => {
  let record;
  for (let i = 0; i < 12; i++) record = rememberCheckout(record, { checkoutAttempt: String(i) });
  assert.equal(record.checkoutAttempts.length, 8);
  assert.equal(checkoutForAttempt(record, '0'), null);
  assert.equal(checkoutForAttempt({ ...record, status: 'closed' }, '10'), null);
});

test('Lambda context and explicit Blobs credentials initialize the real store', async () => {
  const keys = ['NETLIFY_BLOBS_CONTEXT', 'NETLIFY_BLOBS_TOKEN', 'NETLIFY_BLOBS_SITE_ID'];
  const prior = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    await withBlobs(async () => assert.equal(store().name, 'site:portabase-cloud-subscriptions'))({
      blobs: Buffer.from(JSON.stringify({ url: 'https://blobs.example', token: 'test-token' })).toString('base64'),
      headers: { 'x-nf-site-id': 'test-site', 'x-nf-deploy-id': 'test-deploy' },
    });
    delete process.env.NETLIFY_BLOBS_CONTEXT;
    process.env.NETLIFY_BLOBS_TOKEN = 'test-token'; process.env.NETLIFY_BLOBS_SITE_ID = 'test-site';
    assert.equal(store().name, 'site:portabase-cloud-subscriptions');
  } finally { for (const key of keys) { if (prior[key] === undefined) delete process.env[key]; else process.env[key] = prior[key]; } }
});

test('real session and logout clear persisted demo state', () => {
  const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
  globalThis.localStorage = storage(); globalThis.sessionStorage = storage();
  try {
    sessionStorage.setItem('portabase.console.demo', '1');
    localStorage.setItem('portabase.sim_customer_token', 'sim_customer_old');
    saveSession({ provider: 'supabase', accessToken: 'real-session-token', user });
    assert.equal(sessionStorage.getItem('portabase.console.demo'), null);
    assert.equal(localStorage.getItem('portabase.sim_customer_token'), null);
    sessionStorage.setItem('portabase.console.demo', '1'); clearSession();
    assert.equal(sessionStorage.getItem('portabase.console.demo'), null);
  } finally { delete globalThis.localStorage; delete globalThis.sessionStorage; }
});

test('production auth UI guards simulation and console rechecks demo after session restoration', async () => {
  const auth = await readFile(new URL('../src/auth-pages.jsx', import.meta.url), 'utf8');
  assert.match(auth, /import.meta.env.DEV && .*\r?\n\s*<SimulatedCustomerSection/);
  const consoleSource = await readFile(new URL('../src/console/ConsoleApp.jsx', import.meta.url), 'utf8');
  assert.match(consoleSource, /await ensureSessionForVersion\(version\);\s*if \(isRealSession\(session\)\)/);
});

test('preview gate preserves path/query and bypasses auth callbacks', async () => {
  globalThis.Netlify = { env: { get: () => '1234' } };
  try {
    const response = await siteGate(new Request('https://portabase.dev/login?next=%2Fdashboard', { method: 'POST', body: new URLSearchParams({ code: '1234' }) }), {});
    assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/login?next=%2Fdashboard');
    assert.equal(await siteGate(new Request('https://portabase.dev/auth/callback?code=provider-code'), { next: () => 'passed' }), 'passed');
  } finally { delete globalThis.Netlify; }
});


test('new Starter checkout is blocked until reviewed managed release is enabled; legacy plans remain available',async()=>{
 let calls=0;const run=createSubscribeHandler({authenticate:async()=>user,get:async()=>null,configuration:async()=>({starterVariationId:'approved',usageImageDigest:'sha256:'+'a'.repeat(64)}),credentials:async()=>{calls++;return {locationId:'loc'};},authConfig:async()=>({})});
 const result=await run(event({planId:'cloud-9'}));assert.equal(result.statusCode,503);assert.equal(JSON.parse(result.body).error,'managed_starter_not_ready');assert.equal(calls,0);
});
