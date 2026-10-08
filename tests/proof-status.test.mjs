import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveProofStatus, proofFromConsoleState, PROOF_GREEN, PROOF_RED } from '../src/lib/proof-status.js';

const HASH = 'a'.repeat(64);

test('dashboard stays red without a real dry-run MATCH', () => {
  assert.equal(deriveProofStatus({}).tone, PROOF_RED);
  assert.equal(deriveProofStatus({ demoMode: true, report: { kind: 'dry-run', source: 'runner', verdict: 'MATCH', capsuleHash: HASH } }).tone, PROOF_RED);
  assert.equal(deriveProofStatus({ report: { kind: 'heartbeat', source: 'runner', verdict: 'MATCH', capsuleHash: HASH } }).tone, PROOF_RED);
  assert.equal(deriveProofStatus({ report: { kind: 'dry-run', source: 'demo', verdict: 'MATCH', capsuleHash: HASH } }).tone, PROOF_RED);
  assert.equal(deriveProofStatus({ report: { kind: 'compare', source: 'cli', verdict: 'DRIFT', capsuleHash: HASH } }).tone, PROOF_RED);
});

test('runner/CLI compare MATCH records comparison evidence without claiming tested recovery', () => {
  const green = deriveProofStatus({
    report: { kind: 'compare', source: 'cli', verdict: 'MATCH', capsuleHash: HASH, comparedAt: '2026-09-19T00:00:00.000Z' },
  });
  assert.equal(green.tone, PROOF_RED);
  assert.equal(green.proven, false);
  assert.equal(green.comparisonMatched, true);
  assert.equal(green.reason, 'restore_not_verified');
});

test('console seed / demo state cannot fake green', () => {
  const proof = proofFromConsoleState({
    demoMode: true,
    capsules: [{ status: 'COMPLETE', verified: true }],
  });
  assert.equal(proof.tone, PROOF_RED);
  assert.equal(proof.reason, 'demo_is_not_proof');
});
