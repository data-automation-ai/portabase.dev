/**
 * Dashboard proof lamp. Stays red until a real dry-run / compare is MATCH.
 * Demo data, mocked gauges, and billed-but-unproven workspaces stay red.
 * Do not fake green.
 */

export const PROOF_RED = 'red';
export const PROOF_GREEN = 'green';

const MATCH_VERDICTS = new Set(['MATCH', 'green', 'pass', 'passed']);
const PROOF_KINDS = new Set(['dry-run', 'compare']);
const TRUSTED_SOURCES = new Set(['runner', 'cli']);

function red(reason, detail = '') {
  return {
    tone: PROOF_RED,
    proven: false,
    label: 'Not proven',
    reason,
    detail,
  };
}

export function deriveProofStatus({ report = null, demoMode = false } = {}) {
  if (demoMode) {
    return red('demo_is_not_proof', 'Demo / mocked gauges are not a dry-run MATCH.');
  }
  if (!report || typeof report !== 'object') {
    return red('no_compare_report', 'No dry-run or compare report has been ingested.');
  }
  if (!PROOF_KINDS.has(String(report.kind || ''))) {
    return red('not_a_dry_run', 'Only dry-run or compare reports can turn the lamp green.');
  }
  if (!TRUSTED_SOURCES.has(String(report.source || ''))) {
    return red('untrusted_source', 'Report must come from the free CLI or a Cloud Runner.');
  }
  if (report.mocked === true || report.demo === true) {
    return red('mocked_report', 'Mocked reports stay red.');
  }
  if (!report.capsuleHash || !/^[a-f0-9]{64}$/i.test(String(report.capsuleHash))) {
    return red('missing_hash', 'A sha256 capsule hash is required.');
  }
  if (!MATCH_VERDICTS.has(String(report.verdict || ''))) {
    return red('compare_not_match', `Verdict ${report.verdict || 'missing'} is not MATCH.`);
  }
  return {
    tone: PROOF_GREEN,
    proven: true,
    label: 'Dry-run MATCH',
    reason: 'compare_match',
    detail: 'A real dry-run/compare from the runner or CLI reported MATCH.',
    capsuleHash: report.capsuleHash,
    comparedAt: report.comparedAt || report.occurredAt || null,
  };
}

export function proofFromConsoleState(state, { demoMode = false } = {}) {
  return deriveProofStatus({
    report: state?.proofReport || null,
    demoMode: demoMode || state?.demoMode === true,
  });
}
