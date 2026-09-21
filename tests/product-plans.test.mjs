import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDON_TRANSFERS_PER_24H,
  BASE_TRANSFERS_PER_24H,
  CLOUD_DEFAULT_PLAN_ID,
  CLOUD_FREE,
  CLOUD_PLANS,
  EXTRA_TRANSFERS_ADDON_ID,
  countTransfersLast24h,
  extraTransfersAddonPublic,
  getCloudPlan,
  minScheduleHours,
  planAllowanceCopy,
  planPriceRangeLabel,
  publicCloudPlans,
  resolvePlan,
  storageUsage,
  transferWindow,
} from '../src/lib/product.js';
import {
  CLOUD_PLANS as serverPlans,
  CLOUD_FREE as serverFree,
  getCloudPlan as serverGet,
  publicPlansPayload,
  transferWindow as serverWindow,
} from '../netlify/shared/product.mjs';

test('Cloud Free is 100 MB, not a Square plan, and has no scheduled service', () => {
  assert.equal(CLOUD_FREE.priceMonthlyCents, 0);
  assert.equal(CLOUD_FREE.projects, 1);
  assert.equal(CLOUD_FREE.storageCapMb, 100);
  assert.equal(CLOUD_FREE.storageCapLabel, '100 MB');
  assert.equal(CLOUD_FREE.storageCapBytes, 100 * 1024 * 1024);
  assert.equal(CLOUD_FREE.scheduled, false);
  assert.equal(Object.prototype.hasOwnProperty.call(CLOUD_PLANS, 'cloud-free'), false);
  assert.equal(getCloudPlan('cloud-free').id, 'cloud-free');
  assert.equal(serverFree.storageCapMb, 100);
  assert.equal(serverGet('cloud-free').scheduled, false);
});

test('public Square plans are $7 / 10 GB / 1 per 24h and $17 / 25 GB / 3 per day', () => {
  assert.equal(CLOUD_PLANS['cloud-7'].priceMonthlyCents, 700);
  assert.equal(CLOUD_PLANS['cloud-7'].storageCapGb, 10);
  assert.equal(CLOUD_PLANS['cloud-7'].databases, 1);
  assert.equal(CLOUD_PLANS['cloud-7'].transfersPer24h, 1);
  assert.equal(CLOUD_PLANS['cloud-17'].priceMonthlyCents, 1700);
  assert.equal(CLOUD_PLANS['cloud-17'].storageCapGb, 25);
  assert.equal(CLOUD_PLANS['cloud-17'].databasesUnlimited, true);
  assert.equal(CLOUD_PLANS['cloud-17'].transfersPer24h, 3);
  assert.equal(CLOUD_PLANS['cloud-7'].smsOptional, false);
  assert.equal(CLOUD_PLANS['cloud-17'].smsOptional, true);
  assert.equal(CLOUD_DEFAULT_PLAN_ID, 'cloud-17');
  assert.equal(planPriceRangeLabel(), '$7 / $17');
  assert.deepEqual(publicCloudPlans().map((p) => p.id), ['cloud-7', 'cloud-17']);
  assert.equal(CLOUD_PLANS['cloud-37'].customerFacing, false);
  assert.equal(getCloudPlan('cloud-27').id, 'cloud-17');
  assert.equal(resolvePlan({ extraCycles: 2 }).id, 'cloud-17');
  assert.match(planAllowanceCopy('cloud-free'), /100 MB/);
  assert.match(planAllowanceCopy('cloud-7'), /10 GB/);
  assert.match(planAllowanceCopy('cloud-17'), /25 GB/);
});

test('browser and server plan tables stay in sync', () => {
  for (const id of Object.keys(CLOUD_PLANS)) {
    assert.equal(CLOUD_PLANS[id].priceMonthlyCents, serverPlans[id].priceMonthlyCents);
    assert.equal(CLOUD_PLANS[id].storageCapGb, serverPlans[id].storageCapGb);
    assert.equal(serverGet(id).id, id);
  }
  const payload = publicPlansPayload();
  assert.equal(payload['cloud-7'].storageCapLabel, '10 GB');
  assert.equal(payload['cloud-17'].storageCapLabel, '25 GB');
  assert.equal(payload['cloud-17'].transfersPer24h, 3);
  assert.equal(payload['cloud-37'].customerFacing, false);
});

test('$7 includes 1 transfer / 24h; $17 includes 3; add-on still raises a 1-slot plan', () => {
  assert.equal(CLOUD_PLANS['cloud-7'].cyclesPerDay, BASE_TRANSFERS_PER_24H);
  assert.equal(CLOUD_PLANS['cloud-17'].transfersPer24h, ADDON_TRANSFERS_PER_24H);
  const base = transferWindow({ usedLast24h: 1, extraTransfersAddon: false, planId: 'cloud-7' });
  assert.equal(base.allowance, 1);
  assert.equal(base.atLimit, true);
  const daily = transferWindow({ usedLast24h: 1, extraTransfersAddon: false, planId: 'cloud-17' });
  assert.equal(daily.allowance, 3);
  assert.equal(daily.atLimit, false);
  const addon = transferWindow({ usedLast24h: 1, extraTransfersAddon: true, planId: 'cloud-7' });
  assert.equal(addon.allowance, ADDON_TRANSFERS_PER_24H);
  assert.equal(serverWindow({ extraTransfersAddon: false, planId: 'cloud-7' }).allowance, 1);
  assert.equal(minScheduleHours({ planId: 'cloud-7' }), 24);
  assert.equal(minScheduleHours({ planId: 'cloud-17' }), 8);
  const pub = extraTransfersAddonPublic('cloud-17');
  assert.equal(pub.id, EXTRA_TRANSFERS_ADDON_ID);
  assert.equal(pub.transfersPer24h, 3);
  assert.equal(extraTransfersAddonPublic('cloud-7').priceMonthlyUsd, 3);
});

test('countTransfersLast24h uses a rolling window', () => {
  const now = Date.parse('2026-09-18T21:00:00.000Z');
  const items = [
    { createdAt: '2026-09-18T20:00:00.000Z' },
    { createdAt: '2026-09-17T22:00:00.000Z' },
    { createdAt: '2026-09-17T20:00:00.000Z' },
  ];
  assert.equal(countTransfersLast24h(items, { now }), 2);
});

test('storageUsage meters against the plan cap', () => {
  const oneGb = 1024 * 1024 * 1024;
  const usage = storageUsage(oneGb * 8, 'cloud-17');
  assert.equal(usage.capGb, 25);
  assert.equal(usage.percent, 32);
  assert.equal(usage.overCap, false);
  assert.equal(storageUsage(oneGb * 11, 'cloud-7').overCap, true);
  assert.equal(storageUsage(50 * 1024 * 1024, 'cloud-free').overCap, false);
  assert.equal(storageUsage(120 * 1024 * 1024, 'cloud-free').overCap, true);
});
