import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  AWS_RUN_PLAN_KIND,
  buildAwsRunPlan,
  buildDoctorReport,
  buildInventory,
  decideBinaryPath,
  formatAwsRunPlanMarkdown,
  formatAwsRunPlanText,
  runAwsCli,
  ACTIONS,
  RESOURCE_CLASS,
} from '../utility/aws/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'utility/aws/fixtures/sample-account.json');

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('volume with latest completed snap references it instead of CreateSnapshot', async () => {
  const inventory = buildInventory(await loadFixture());
  const daily = inventory.resources.find((r) => r.id === 'vol-daily');
  const decision = decideBinaryPath(daily);
  assert.equal(decision.action, ACTIONS.RECOMMEND_SNAPSHOT);
  assert.equal(decision.finding, 'will-copy');
  assert.equal(decision.recommendedPath, 'reference-latest-completed-snapshot');
  assert.match(decision.reason, /snap-daily-new/);
  assert.match(decision.reason, /never holds the bytes/i);
});

test('older AMI in a series is not the capsule reference', async () => {
  const inventory = buildInventory(await loadFixture());
  const older = inventory.resources.find((r) => r.id === 'ami-capece-old');
  const newest = inventory.resources.find((r) => r.id === 'ami-capece-new');
  assert.equal(decideBinaryPath(newest).finding, 'will-copy');
  assert.equal(decideBinaryPath(older).finding, 'will-warn');
  assert.ok(decideBinaryPath(older).restoreBlockers.includes('older-ami-in-series'));
});

test('doctor manifest records most-recent snapshot ids', async () => {
  const inventory = buildInventory(await loadFixture());
  const report = buildDoctorReport(inventory);
  const daily = report.manifest.binaryReferences.ebsSnapshots.find((row) => row.volumeId === 'vol-daily');
  assert.equal(daily.snapshotId, 'snap-daily-new');
  assert.equal(daily.policy, 'most_recent');
  assert.equal(daily.status, 'referenced-latest-completed');
  const missing = report.manifest.binaryReferences.ebsSnapshots.find((row) => row.volumeId === 'vol-111');
  assert.equal(missing.snapshotId, null);
  assert.equal(missing.status, 'recommended-not-created');
  assert.equal(report.manifest.binaryReferences.latestPolicy.name, 'most_recent');
  assert.equal(report.manifest.binaryReferences.latestPolicy.neverHoldsBytes, true);
  assert.equal(
    report.manifest.binaryReferences.latestPolicy.s3Series.selected[0].key,
    'nightly/db-20260801-0700.dump',
  );
  assert.equal(report.proven, false);
  assert.equal(report.match, false);
});

test('run plan scripts inventory → doctor → latest → export → seal and stays dry-run', async () => {
  const inventory = buildInventory(await loadFixture());
  const plan = buildAwsRunPlan(inventory, { fixturePath: 'utility/aws/fixtures/sample-account.json' });
  assert.equal(plan.kind, AWS_RUN_PLAN_KIND);
  assert.equal(plan.dryRun, true);
  assert.equal(plan.mutate, false);
  assert.equal(plan.neverHoldsBytes, true);
  assert.equal(plan.neverHoldsAwsKeys, true);
  assert.equal(plan.runnerLocalAws, true);
  assert.equal(plan.neverStageOnC, true);
  assert.equal(plan.proven, false);
  assert.equal(plan.match, false);
  assert.deepEqual(plan.steps.map((s) => s.id), [
    'inventory',
    'doctor',
    'latest-snapshot-resolve',
    'binary-export-s3',
    'binary-export-ami',
    'create-snapshot-if-missing',
    'capsule-seal',
  ]);
  assert.equal(plan.steps.find((s) => s.id === 'binary-export-ami').blocked, true);
  assert.equal(plan.steps.find((s) => s.id === 'binary-export-ami').mutate, true);
  assert.equal(plan.steps.find((s) => s.id === 'create-snapshot-if-missing').blocked, true);
  assert.ok(plan.steps.every((s) => s.blocked || s.mutate === false));

  const resolve = plan.steps.find((s) => s.id === 'latest-snapshot-resolve');
  assert.ok(resolve.resolved.volumes.some((row) => row.volumeId === 'vol-daily' && row.snapshotId === 'snap-daily-new'));
  assert.ok(resolve.resolved.amis.some((row) => row.amiId === 'ami-capece-new'));
  assert.ok(resolve.commands.some((cmd) => /aws-latest-ebs-snapshot\.ps1/.test(cmd)));

  const s3 = plan.steps.find((s) => s.id === 'binary-export-s3');
  assert.match(s3.commands[0], /export-binary-backups-interactive\.ps1/);
  assert.match(s3.commands[0], /-ListOnly/);
  assert.equal(s3.resolved.selected[0].key, 'nightly/db-20260801-0700.dump');

  const missing = plan.steps.find((s) => s.id === 'create-snapshot-if-missing');
  assert.ok(missing.commands.some((cmd) => /vol-111/.test(cmd)));
  assert.ok(!missing.commands.some((cmd) => /vol-daily/.test(cmd)));

  const text = formatAwsRunPlanText(plan);
  assert.match(text, /dry-run/i);
  assert.match(text, /never holds the bytes/i);
  assert.match(text, /MATCH is false/);
  const md = formatAwsRunPlanMarkdown(plan);
  assert.match(md, /# AWS capsule run plan/);
  assert.match(md, /snap-daily-new/);
  assert.match(md, /Never stage hundreds of GB on C:/);
});

test('CLI aws plan refuses --live and emits JSON', async () => {
  const logs = [];
  const io = { log: (line) => logs.push(String(line)), error: () => {} };
  await assert.rejects(
    () => runAwsCli(['plan', '--live', '--fixture', fixturePath], io),
    /read-only/,
  );
  await assert.rejects(
    () => runAwsCli(['plan', '--create-snapshot', '--fixture', fixturePath], io),
    /read-only/,
  );
  const plan = await runAwsCli(['plan', '--fixture', fixturePath, '--json'], io);
  assert.equal(plan.command, 'aws plan');
  assert.equal(plan.dryRun, true);
  assert.match(logs.join('\n'), /portabase-aws-run-plan/);
});

test('wired CLI: portabase aws plan --fixture is dry-run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'aws-plan-'));
  const out = join(dir, 'plan.json');
  const md = join(dir, 'AWS_RUN_PLAN.md');
  try {
    const result = spawnSync(
      process.execPath,
      [
        join(root, 'utility/portabase.mjs'),
        'aws',
        'plan',
        '--fixture',
        fixturePath,
        '--json',
        '--out',
        out,
        '--md',
        md,
      ],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const plan = JSON.parse(await readFile(out, 'utf8'));
    assert.equal(plan.kind, AWS_RUN_PLAN_KIND);
    assert.equal(plan.dryRun, true);
    const markdown = await readFile(md, 'utf8');
    assert.match(markdown, /most recent completed/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('help lists aws plan', () => {
  const help = spawnSync(process.execPath, [join(root, 'utility/portabase.mjs'), 'help'], {
    encoding: 'utf8',
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /aws plan/);
});
