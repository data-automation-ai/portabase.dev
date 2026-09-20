import test from 'node:test';
import assert from 'node:assert/strict';
import { PROOF_GREEN, PROOF_RED } from '../src/lib/proof-status.js';
import {
  buildBackupLog,
  buildCapsuleSizeBreakdown,
  buildDashboardCharts,
  buildDashboardModel,
  destinationHint,
  emptyDashboardModel,
  sanitizeJobTelemetry,
  sampleDashboardJobs,
  usedEngineFlags,
} from '../src/lib/dashboard-view.js';

const HASH = 'a'.repeat(64);

test('sanitizeJobTelemetry keeps allowlisted fields and drops secrets', () => {
  const clean = sanitizeJobTelemetry({
    jobId: 'job_1',
    type: 'backup',
    status: 'running',
    phase: 'storage',
    startedAt: '2026-09-20T12:00:00.000Z',
    objectCount: 12,
    sizeBytes: 4096,
    dbBytes: 1000,
    storageBytes: 2800,
    functionsBytes: 296,
    destinationKind: 's3',
    region: 'us-east-1',
    errorCode: 'destination_unreachable',
    passphrase: 'nope',
    payload: { passphrase: 'nope', objectCount: 12, objectName: 'avatars/secret.jpg' },
  });
  const json = JSON.stringify(clean);
  assert.equal(clean.jobId, 'job_1');
  assert.equal(clean.destinationKind, 's3');
  assert.equal(clean.objectCount, 12);
  assert.equal(clean.passphrase, undefined);
  assert.doesNotMatch(json, /nope|avatars|secret\.jpg|passphrase/);
});

test('empty dashboard does not invent live customer jobs', () => {
  const model = emptyDashboardModel({ planId: 'cloud-17' });
  assert.equal(model.source, 'empty');
  assert.equal(model.jobs.length, 0);
  assert.equal(model.empty, true);
  assert.equal(model.proof.tone, PROOF_RED);
  assert.match(model.labeled, /not live/i);
});

test('demo dashboard is labeled sample UI and cannot go green', () => {
  const model = buildDashboardModel({
    demoMode: true,
    proof: { kind: 'compare', source: 'runner', verdict: 'MATCH', capsuleHash: HASH },
  });
  assert.equal(model.source, 'demo');
  assert.equal(model.demo, true);
  assert.ok(model.jobs.length > 0);
  assert.equal(model.proof.tone, PROOF_RED);
  assert.match(model.labeled, /Sample UI/i);
  assert.ok(model.log.every((row) => row.lamp.tone === PROOF_RED));
});

test('capsule size breakdown uses layer hashes/counts when present', () => {
  const size = buildCapsuleSizeBreakdown({
    id: 'job_2',
    sizeBytes: 1000,
    dbBytes: 400,
    storageBytes: 500,
    functionsBytes: 80,
    objectCount: 9,
    destinationKind: 'dropbox',
  });
  assert.equal(size.totalBytes, 1000);
  assert.equal(size.hasBreakdown, true);
  assert.equal(size.layers.find((l) => l.id === 'database').bytes, 400);
  assert.equal(size.layers.find((l) => l.id === 'storage').bytes, 500);
  assert.equal(size.layers.find((l) => l.id === 'functions').bytes, 80);
});

test('backup log stays red unless a real MATCH report is attached', () => {
  const jobs = sampleDashboardJobs(Date.parse('2026-09-20T12:00:00.000Z'));
  const redLog = buildBackupLog(jobs, { demoMode: false });
  assert.ok(redLog.length >= 2);
  assert.ok(redLog.every((row) => row.lamp.tone === PROOF_RED));

  const green = buildBackupLog([{
    id: 'job_match',
    type: 'backup',
    status: 'COMPLETE',
    startedAt: '2026-09-20T11:00:00.000Z',
    finishedAt: '2026-09-20T11:10:00.000Z',
    sizeBytes: 100,
    capsuleHash: HASH,
    compareVerdict: 'MATCH',
    verified: true,
  }], {
    proof: { kind: 'compare', source: 'cli', verdict: 'MATCH', capsuleHash: HASH },
  });
  assert.equal(green[0].lamp.tone, PROOF_GREEN);
  assert.equal(green[0].lamp.label, 'MATCH');
});

test('charts produce honest empty series and plan allowance', () => {
  const empty = buildDashboardCharts([], { planId: 'cloud-7', now: Date.parse('2026-09-20T12:00:00.000Z') });
  assert.equal(empty.empty, true);
  assert.equal(empty.series.length, 7);
  assert.ok(empty.series.every((row) => row.success === 0 && row.sizeBytes === 0));
  assert.equal(empty.usage.capGb, 1);
  assert.equal(empty.transferWindow.allowance, 1);
});

test('engine flags surface only when used — no invented CLI flags', () => {
  assert.deepEqual(usedEngineFlags({}), []);
  const used = usedEngineFlags({ excludeBinaries: true, excludeTableList: 'public.noise', forceOrphanFks: true });
  assert.deepEqual(used.map((f) => f.cli), ['--exclude-binaries', '--exclude-table-list', '--force-orphan-fks']);
  assert.equal(used.find((f) => f.id === 'forceOrphanFks').surfaceOnly, true);
});

test('destination hints never claim Portabase holds capsule bytes', () => {
  for (const kind of ['s3', 'dropbox', 'local', 'unknown']) {
    const hint = destinationHint(kind);
    assert.match(hint.hint, /never (holds )?capsule bytes/i);
    assert.doesNotMatch(hint.hint, /portabase stores your archive/i);
  }
});
