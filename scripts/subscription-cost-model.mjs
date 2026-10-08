#!/usr/bin/env node
/**
 * Planning model only. Does not change plans, charge customers, or call providers.
 * Rates checked 2026-10-04 against:
 * https://developers.cloudflare.com/containers/platform/pricing/
 * https://developers.cloudflare.com/r2/pricing/
 *
 * Compute stops billing only when the container sleeps/stops. Memory and disk
 * use provisioned capacity; CPU uses active vCPU time. Shared free allowances
 * are deliberately excluded, so every customer cannot claim the same allowance.
 * R2 rates are marginal allocations before account-wide rounding. R2 free
 * egress does not establish free egress from a Container connected to R2.
 * GB = decimal GB; memory GiB follows Cloudflare instance specifications.
 */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const RATES = Object.freeze({
  activeVcpuSecond: 0.000020,
  memoryGibSecond: 0.0000025,
  diskGbSecond: 0.00000007,
  egressGb: 0.025, // North America / Europe. Other regions: $0.04 or $0.05.
  r2GbMonth: 0.015,
  r2ClassAOperation: 4.50 / 1e6,
  r2ClassBOperation: 0.36 / 1e6,
  workersPaidMonth: 5,
});

export const DEFAULTS = Object.freeze({
  days: 30,
  vcpus: 1, memoryGib: 6, diskGb: 12, // standard-2; benchmark smaller types later.
  stateGb: 0.1, // Illustrative encrypted durable state; NOT retained capsule data.
  retainedCapsuleGb: 0, // Customer-owned vault by default; enter operator-paid size.
  classAOperations: 0, classBOperations: 0, // Not measured; excluded until supplied.
  copyFactor: 1, // Full uncompressed output, one outbound copy, no retries/restores.
  extraEgressGb: 0,
  customers: 100, // Allocates the shared Workers Paid fixed fee; not a sales forecast.
  otherFixedPlatform: 0,
  supportReserve: 0, smsReserve: 0, emailReserve: 0, variablePlatformReserve: 0,
  egressGbRate: RATES.egressGb,
  includedEgressGb: null, // null = no metered revenue; no commercial cap selected.
  extraGbPrice: 0.10, // Scenario only, requires owner decision.
  overageFeeFraction: 0.03, // Assumption, NOT a verified Square contract rate.
  overageTransactionFee: 0, // Incremental monthly invoice fee, never per GB.
});

function requireNonnegative(name, value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be finite and nonnegative`);
}

export function calculate(input) {
  const p = { ...DEFAULTS, ...input };
  for (const [key, value] of Object.entries(p)) {
    if (value !== null) requireNonnegative(key, value);
  }
  if (!p.customers || !p.days || !p.gross || p.cpuFraction > 1 || p.overageFeeFraction >= 1) {
    throw new RangeError('Customers, days, and gross must be positive; CPU fraction <= 1; fee fraction < 1');
  }
  for (const key of ['gross', 'sourceGb', 'runsPerDay', 'minutesPerRun', 'cpuFraction']) {
    requireNonnegative(key, p[key]);
  }
  if (p.netBase !== null) {
    requireNonnegative('netBase', p.netBase);
    if (p.netBase > p.gross) throw new RangeError('netBase cannot exceed gross');
  }
  const runs = p.days * p.runsPerDay;
  const runningSeconds = runs * p.minutesPerRun * 60;
  if (runningSeconds > p.days * 86400) throw new RangeError('A single runner cannot execute more than 24 hours per day');
  const cpu = runningSeconds * p.vcpus * p.cpuFraction * RATES.activeVcpuSecond;
  const memory = runningSeconds * p.memoryGib * RATES.memoryGibSecond;
  const disk = runningSeconds * p.diskGb * RATES.diskGbSecond;
  const compute = cpu + memory + disk;
  const outboundGb = p.sourceGb * runs * p.copyFactor + p.extraEgressGb;
  const egress = outboundGb * p.egressGbRate;
  const durableStorage = (p.stateGb + p.retainedCapsuleGb) * RATES.r2GbMonth;
  const requests = p.classAOperations * RATES.r2ClassAOperation + p.classBOperations * RATES.r2ClassBOperation;
  const fixedPlatformPerCustomer = (RATES.workersPaidMonth + p.otherFixedPlatform) / p.customers;
  const reserves = p.supportReserve + p.smsReserve + p.emailReserve + p.variablePlatformReserve;
  const nonTransferCost = compute + durableStorage + requests + fixedPlatformPerCustomer + reserves;
  const totalCost = nonTransferCost + egress;
  const overageGb = p.includedEgressGb === null ? 0 : Math.max(0, outboundGb - p.includedEgressGb);
  const overageGross = overageGb * p.extraGbPrice;
  const overageNet = overageGross * (1 - p.overageFeeFraction) - (overageGross > 0 ? p.overageTransactionFee : 0);
  const baseContribution = p.netBase === null ? null : p.netBase - totalCost;
  const meteredContribution = baseContribution === null ? null : baseContribution + overageNet;
  const headroomBeforeTransfer = p.netBase === null ? null : p.netBase - nonTransferCost;
  return {
    inputs: p, runs, runningSeconds, outboundGb,
    costs: { cpu, memory, disk, compute, egress, durableStorage, requests, fixedPlatformPerCustomer, reserves, totalCost },
    baseContribution, // After listed expenses, BEFORE unspecified business costs/tax.
    baseMarginOnGross: baseContribution === null ? null : baseContribution / p.gross,
    baseMarginOnNet: baseContribution === null || p.netBase === 0 ? null : baseContribution / p.netBase,
    headroomBeforeTransfer,
    breakEvenTransferGb: headroomBeforeTransfer === null || p.egressGbRate === 0 ? null : Math.max(0, headroomBeforeTransfer / p.egressGbRate),
    overageGb, overageGross, overageNet, meteredContribution,
    customerTotalGross: p.gross + overageGross,
    meteredMarginOnGross: meteredContribution === null ? null : meteredContribution / (p.gross + overageGross),
    egressOnlyOverageBreakEvenPrice: p.egressGbRate / (1 - p.overageFeeFraction),
  };
}

export function selfTest() {
  const base = { gross: 7, netBase: 6.5, sourceGb: 10, runsPerDay: 1, minutesPerRun: 15, cpuFraction: 0.25 };
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  const full = calculate(base);
  near(full.outboundGb, 300);
  near(full.costs.egress, 7.5);
  near(full.costs.compute, 0.56268);
  assert.ok(full.baseContribution < 0);
  const triple = calculate({ ...base, runsPerDay: 3 });
  near(triple.costs.egress, 22.5);
  near(triple.costs.compute, 3 * full.costs.compute);
  const metered = calculate({ ...base, includedEgressGb: 100, extraGbPrice: 0.10, overageFeeFraction: 0.03, overageTransactionFee: 0.30 });
  near(metered.overageGross, 20);
  near(metered.overageNet, 19.10); // One incremental invoice fee, not 200 fees.
  near(calculate({ ...base, includedEgressGb: 300, overageTransactionFee: 0.30 }).overageNet, 0);
  const noFeeAssumption = calculate({ ...base, gross: 17, netBase: null });
  assert.equal(noFeeAssumption.baseContribution, null);
  assert.equal(noFeeAssumption.baseMarginOnNet, null);
  const overhead = calculate({ ...base, supportReserve: 1, customers: 1 });
  near(full.baseContribution - overhead.baseContribution, 5.95);
  near(calculate({ ...base, minutesPerRun: 1440, cpuFraction: 0 }).costs.compute, 41.05728);
  assert.throws(() => calculate({ ...base, cpuFraction: 1.1 }), RangeError);
  assert.throws(() => calculate({ ...base, runsPerDay: 3, minutesPerRun: 1440 }), RangeError);
  assert.throws(() => calculate({ ...base, sourceGb: -1 }), RangeError);
  assert.throws(() => calculate({ ...base, overageFeeFraction: 1 }), RangeError);
  return 'Cost arithmetic and guard checks passed.';
}

function main() {
  const names = [
    'net17', 'days', 'customers', 'stateGb', 'retainedCapsuleGb', 'classAOperations', 'classBOperations',
    'supportReserve', 'smsReserve', 'emailReserve', 'variablePlatformReserve', 'otherFixedPlatform',
    'egressGbRate', 'extraGbPrice', 'overageFeeFraction', 'overageTransactionFee', 'copyFactor', 'extraEgressGb',
    'vcpus', 'memoryGib', 'diskGb', 'cap7', 'cap17',
  ];
  const options = Object.fromEntries(names.map(name => [name, { type: 'string' }]));
  for (const name of ['json', 'help', 'self-test']) options[name] = { type: 'boolean', default: false };
  const { values } = parseArgs({ options });
  if (values.help) {
    console.log(`Usage: node scripts/subscription-cost-model.mjs [--json] [--self-test]
Numeric overrides: ${names.map(name => `--${name} N`).join(' ')}
Example scenario (NOT approved pricing or measured costs):
  node scripts/subscription-cost-model.mjs --net17 16.20 --cap7 5 --cap17 100 --supportReserve 0.50 --smsReserve 0.25 --emailReserve 0.05 --variablePlatformReserve 0.20
Default $7 net proceeds are the owner's $6.50 assumption. $17 net is unknown until --net17 is supplied.
Caps are monthly outbound GB. No overage revenue is counted until a cap is supplied.
All cost reserves default to zero and are unmeasured; use actual bills and benchmark durations before launch.`);
    return;
  }
  if (values['self-test']) { console.log(selfTest()); return; }
  const overrides = {};
  for (const name of names) if (values[name] !== undefined) {
    if (!values[name].trim()) throw new RangeError(`${name} cannot be blank`);
    overrides[name] = Number(values[name]);
    requireNonnegative(name, overrides[name]);
  }
  const { net17 = null, cap7 = null, cap17 = null, ...shared } = overrides;
  const plans = [
    { gross: 7, netBase: 6.5, runsPerDay: 1, includedEgressGb: cap7 },
    { gross: 17, netBase: net17, runsPerDay: 3, includedEgressGb: cap17 },
  ];
  const results = plans.flatMap(plan => [0.1, 1, 10].flatMap(sourceGb => [15, 60].flatMap(minutesPerRun => [0.25, 1].map(cpuFraction => calculate({
    ...shared, ...plan, sourceGb, minutesPerRun, cpuFraction,
  })))));
  const report = {
    ratesChecked: '2026-10-04',
    sources: ['https://developers.cloudflare.com/containers/platform/pricing/', 'https://developers.cloudflare.com/r2/pricing/'],
    assumptions: { ...DEFAULTS, ...shared, net7: 6.5, net17, cap7, cap17 },
    notes: [
      'Scenario model, not measured profit. Full copies; one outbound destination; no shared free allowances.',
      'Runner identity/state persist; these compute scenarios require stopping between jobs. Always-on idle compute is shown separately.',
      '15/60 minutes and 25/100% CPU are scenarios, not throughput benchmarks. Unlimited database count can increase per-job overhead.',
      '12 GB temporary disk does not establish capacity for a 10 GB capture; encryption/archive/verification may require multiple copies.',
      'State is encrypted configuration/manifests, not capsule retention. Customer vault bills and source-provider egress are separate.',
      'Worker/Durable Object/database/logging usage and email/SMS/support are excluded unless covered by supplied reserves.',
      'R2 allocations are marginal estimates; actual account bill rounds units. Snapshot persistence costs are not substituted with R2 rates.',
      'Retries, restores, second destinations and compression change transfer. Use copyFactor and extraEgressGb for scenarios.',
      'Overage price and processor fraction are assumptions. Overage covers only bandwidth; extra compute/storage must also be budgeted.',
      'No tax, refunds, chargebacks, fraud, customer-acquisition cost or development salaries included. Positive contribution is not proven profit.',
    ],
    fixedWorkersFeePerCustomer: [1, 10, 100, 1000].map(customers => ({ customers, dollars: RATES.workersPaidMonth / customers })),
    idleAlwaysRunningCompute: calculate({ ...shared, gross: 7, netBase: 6.5, sourceGb: 0, runsPerDay: 1, minutesPerRun: 1440, cpuFraction: 0 }).costs.compute,
    results,
  };
  if (values.json) { console.log(JSON.stringify(report, null, 2)); return; }
  console.log('Portabase monthly runner cost scenarios (USD; planning only)');
  console.log(`Shared assumptions: ${JSON.stringify(report.assumptions)}`);
  const dollars = number => number === null ? '?' : number.toFixed(2);
  const percent = number => number === null ? '?' : `${(number * 100).toFixed(1)}%`;
  console.table(results.map(row => ({
    plan: `$${row.inputs.gross}`, sourceGB: row.inputs.sourceGb, runsDay: row.inputs.runsPerDay,
    minRun: row.inputs.minutesPerRun, CPU: percent(row.inputs.cpuFraction), outGB: row.outboundGb,
    compute: dollars(row.costs.compute), egress: dollars(row.costs.egress), cost: dollars(row.costs.totalCost),
    baseContribution: dollars(row.baseContribution), grossMargin: percent(row.baseMarginOnGross), netMargin: percent(row.baseMarginOnNet),
    overageBill: dollars(row.overageGross), customerBill: dollars(row.customerTotalGross), meteredContribution: dollars(row.meteredContribution),
    transferBreakEvenGB: row.breakEvenTransferGb === null ? '?' : row.breakEvenTransferGb.toFixed(1),
  })));
  console.log(`Always running, zero CPU use: $${dollars(report.idleAlwaysRunningCompute)}/month memory + disk alone.`);
  console.log(`Shared $5 Workers fixed fee allocation: ${report.fixedWorkersFeePerCustomer.map(row => `${row.customers} customers -> $${row.dollars.toFixed(3)} each`).join('; ')}`);
  console.log('Gross/net margin columns use base contribution divided by subscription gross/net receipts, respectively.');
  console.log('Transfer break-even is the TOTAL monthly outbound GB budget after other listed costs; zero means already unaffordable or no headroom.');
  console.log('Owner decisions: final size limits; runtime/CPU limits; monthly transfer allowance; overage price/spend cap; retained storage; alert allowance; stop-between-jobs architecture.');
  for (const note of report.notes) console.log(`- ${note}`);
  console.log(`Sources checked ${report.ratesChecked}: ${report.sources.join(' | ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
