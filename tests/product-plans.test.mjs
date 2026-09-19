import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADDON_TRANSFERS_PER_24H,
  BASE_TRANSFERS_PER_24H,
  CLOUD_DEFAULT_PLAN_ID,
  CLOUD_PLANS,
  EXTRA_TRANSFERS_ADDON_ID,
  countTransfersLast24h,
  extraTransfersAddonPublic,
  getCloudPlan,
  minScheduleHours,
  planPriceRangeLabel,
  resolvePlan,
  storageUsage,
  transferWindow,
} from '../src/lib/product.js';
import {
  CLOUD_PLANS as serverPlans,
  getCloudPlan as serverGet,
  publicPlansPayload,
  transferWindow as serverWindow,
} from '../netlify/shared/product.mjs';

test('Square plans are $7 / $17 / $37 with 1 / 10 / 100 GB caps', () => {
  assert.equal(CLOUD_PLANS['cloud-7'].priceMonthlyCents, 700);
  assert.equal(CLOUD_PLANS['cloud-7'].storageCapGb, 1);
  assert.equal(CLOUD_PLANS['cloud-17'].priceMonthlyCents, 1700);
  assert.equal(CLOUD_PLANS['cloud-17'].storageCapGb, 10);
  assert.equal(CLOUD_PLANS['cloud-37'].priceMonthlyCents, 3700);
  assert.equal(CLOUD_PLANS['cloud-37'].storageCapGb, 100);
  assert.equal(CLOUD_PLANS['cloud-7'].smsOptional, false);
  assert.equal(CLOUD_PLANS['cloud-17'].smsOptional, true);
  assert.equal(CLOUD_DEFAULT_PLAN_ID, 'cloud-17');
  assert.equal(planPriceRangeLabel(), '$7 / $17 / $37');
  assert.equal(getCloudPlan('cloud-27').id, 'cloud-37');
  assert.equal(resolvePlan({ extraCycles: 2 }).id, 'cloud-37');
});

test('browser and server plan tables stay in sync', () => {
  for (const id of Object.keys(CLOUD_PLANS)) {
    assert.equal(CLOUD_PLANS[id].priceMonthlyCents, serverPlans[id].priceMonthlyCents);
    assert.equal(CLOUD_PLANS[id].storageCapGb, serverPlans[id].storageCapGb);
    assert.equal(serverGet(id).id, id);
  }
  const payload = publicPlansPayload();
  assert.equal(payload['cloud-7'].storageCapLabel, '1 GB');
  assert.equal(payload['cloud-37'].transfersPer24h, 1);
  assert.equal(payload['cloud-37'].cyclesPerDay, 1);
});

test('every Square base plan includes 1 transfer / 24h; add-on raises to 3', () => {
  for (const id of Object.keys(CLOUD_PLANS)) {
    assert.equal(CLOUD_PLANS[id].cyclesPerDay, BASE_TRANSFERS_PER_24H);
    assert.equal(CLOUD_PLANS[id].escapesPerDay, BASE_TRANSFERS_PER_24H);
  }
  const base = transferWindow({ usedLast24h: 1, extraTransfersAddon: false });
  assert.equal(base.allowance, 1);
  assert.equal(base.atLimit, true);
  assert.equal(base.remaining, 0);
  const addon = transferWindow({ usedLast24h: 1, extraTransfersAddon: true });
  assert.equal(addon.allowance, ADDON_TRANSFERS_PER_24H);
  assert.equal(addon.atLimit, false);
  assert.equal(addon.remaining, 2);
  const full = transferWindow({ usedLast24h: 3, extraTransfersAddon: true });
  assert.equal(full.atLimit, true);
  assert.equal(serverWindow({ extraTransfersAddon: false }).allowance, 1);
  assert.equal(minScheduleHours(), 24);
  assert.equal(minScheduleHours({ extraTransfersAddon: true }), 8);
  const pub = extraTransfersAddonPublic('cloud-17');
  assert.equal(pub.id, EXTRA_TRANSFERS_ADDON_ID);
  assert.equal(pub.transfersPer24h, 3);
  assert.equal(pub.priceTbd, false);
  assert.equal(pub.priceMonthlyUsd, 5);
  assert.equal(extraTransfersAddonPublic('cloud-7').priceMonthlyUsd, 3);
  assert.equal(extraTransfersAddonPublic('cloud-37').priceMonthlyUsd, 5);
  assert.equal(transferWindow({ planId: 'cloud-7' }).addonMonthlyUsd, 3);
  assert.equal(pub.pricesByPlan['cloud-7'].monthlyUsd, 3);
  assert.equal(pub.pricesByPlan['cloud-17'].monthlyUsd, 5);
  assert.equal(pub.pricesByPlan['cloud-37'].monthlyUsd, 5);
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
  assert.equal(usage.capGb, 10);
  assert.equal(usage.percent, 80);
  assert.equal(usage.overCap, false);
  assert.equal(storageUsage(oneGb * 2, 'cloud-7').overCap, true);
});
