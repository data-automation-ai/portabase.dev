import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateCapturePercent, confidentialJobSnapshot } from './engine-jobs.mjs';

test('capture estimate advances through observed phases and never claims completion', () => {
  let value = 0;
  for (const [event, expected] of [
    [{ phase: 'database-manifest' }, 2],
    [{ phase: 'database' }, 5],
    [{ phase: 'storage', completed: 1, total: 4 }, 52],
    [{ phase: 'storage', completed: 4, total: 4 }, 75],
    [{ phase: 'functions' }, 78],
    [{ phase: 'package' }, 85],
    [{ phase: 'encrypt' }, 91],
    [{ phase: 'transfer' }, 96],
    [{ phase: 'done' }, 99],
  ]) {
    value = estimateCapturePercent(value,event);
    assert.equal(value,expected);
  }
  assert.equal(estimateCapturePercent(value,{ phase:'storage', completed:1, total:4 }),99,
    'late events cannot move the estimate backwards');
});

test('malformed or untrusted progress cannot exceed 99 or fabricate a phase', () => {
  assert.equal(estimateCapturePercent(0,{ phase:'storage', completed:1000, total:1 }),75);
  assert.equal(estimateCapturePercent(0,{ phase:'storage', completed:-5, total:1 }),45);
  assert.equal(estimateCapturePercent(0,{ phase:'storage', completed:1, total:0 }),45);
  assert.equal(estimateCapturePercent(0,{ phase:'unknown' }),0);
  assert.equal(estimateCapturePercent(98,{ phase:'done' }),99);
});

test('mock job status labels the percentage estimated until successful completion', () => {
  const job = { id:'job', operation:'backup', state:'running', phase:'transfer', estimatedPercent:96,
    startedAt:'2026-10-25T10:00:00.000Z', finishedAt:null, phaseTimings:[], result:null, error:null };
  assert.deepEqual([confidentialJobSnapshot(job).estimatedPercent,confidentialJobSnapshot(job).progressKind],[96,'estimate']);
  job.state='failed'; job.finishedAt='2026-10-25T10:05:00.000Z';
  assert.equal(confidentialJobSnapshot(job).estimatedPercent,96);
  assert.equal(confidentialJobSnapshot(job).durationMs,300000);
  job.state='complete';
  assert.equal(confidentialJobSnapshot(job).estimatedPercent,100);
  job.operation='restore';
  assert.equal(confidentialJobSnapshot(job).estimatedPercent,null);
});
