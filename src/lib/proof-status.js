/**
 * Comparison reports are evidence about captured data, not proof of recovery.
 * A future restore-evidence ingestion path must verify target isolation,
 * read-back checks and critical application flows before asserting recovery.
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
    return red('demo_is_not_proof', 'Demo data does not prove recovery.');
  }
  if (!report || typeof report !== 'object') {
    return red('no_compare_report', 'No verified restore evidence has been ingested.');
  }
  if (!PROOF_KINDS.has(String(report.kind || ''))) {
    return red('not_a_dry_run', 'This report does not establish a tested restore.');
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
    ...red('restore_not_verified', 'The reported comparison matched. Recovery still needs an isolated restore, read-back checks and tested application flows.'),
    comparisonMatched: true,
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
