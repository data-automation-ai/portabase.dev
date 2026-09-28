/**
 * Portabase AWS Capsule V2 — public module surface.
 * Open source (Apache-2.0). Read-only scaffold; no live AWS mutations.
 */

export {
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_CAPSULE_KIND,
  AWS_COVERAGE_CLAIMS,
  AWS_DEFAULT_PROFILE,
  AWS_INVENTORY_SCHEMA_VERSION,
  versionBanner,
} from './versions.mjs';

export {
  AWS_CAPSULE_MANIFEST_SCHEMA,
  CURRENT_SCHEMA_VERSIONS,
  emptySecretsPolicy,
  unprovenCoverage,
  validateAwsCapsuleManifest,
} from './schema.mjs';

export {
  ACTIONS,
  RESOURCE_CLASS,
  SIZE_POLICY,
  applySizePolicy,
  decideAll,
  decideBinaryPath,
} from './binary-decision.mjs';
export { AWS_PACKAGE_FILES, buildCapsulePackageShape } from './package-shape.mjs';
export {
  AWS_CLI_ALLOWED,
  AWS_CLI_FORBIDDEN,
  assertReadOnlyAwsCli,
} from './readonly-aws-cli.mjs';

export {
  COLLECTOR_CONTRACTS,
  FORBIDDEN_MUTATIONS,
  assertReadOnlyClient,
  createFixtureClient,
  createLiveClient,
  isForbiddenMutation,
  listCollectorServices,
} from './interfaces.mjs';

export { buildInventory, bytesToGiB, estimateScriptedBytes, sumBinaryGiB } from './inventory.mjs';
export { buildDoctorReport, formatDoctorText } from './doctor.mjs';
export {
  awsHelpText,
  parseAwsArgs,
  runAwsCli,
  runAwsDoctor,
  runAwsInventory,
  runAwsPlan,
} from './cli.mjs';
export {
  LATEST_BACKUP_POLICY,
  PinnedBackupRefusedError,
  collectS3ObjectsFromFixture,
  isCriticalRollingBinary,
  powershellBinaryExportCommand,
  powershellLatestSnapshotCommand,
  resolveAccountLatestBackups,
  resolveLatestAmi,
  resolveLatestAmisByPrefixes,
  resolveLatestEbsSnapshot,
  selectMostRecentAmi,
  selectMostRecentCompletedSnapshot,
  selectMostRecentPerSeries,
  seriesKey,
} from './latest-backup.mjs';
export {
  AWS_RUN_PLAN_KIND,
  AWS_RUN_PLAN_VERSION,
  buildAwsRunPlan,
  formatAwsRunPlanMarkdown,
  formatAwsRunPlanText,
} from './run-plan.mjs';
export {
  RUNNER_AWS_AUTH_ERROR,
  RUNNER_AWS_AUTH_MODES,
  RUNNER_AWS_TELEMETRY_ALLOWLIST,
  RUNNER_AWS_TELEMETRY_FORBIDDEN,
  RunnerAwsAuthError,
  assertRunnerAwsAuth,
  detectRunnerAwsAuth,
  redactRunnerAwsAuth,
} from './runner-auth.mjs';
export {
  IAM_TIER,
  assertLeastPrivilegeSketch,
  flattenActions,
  loadMapPolicy,
  loadShipPolicy,
} from './iam/policies.mjs';
export { COST_SIGNALS, estimateMonthlyUsd } from './cost-signals.mjs';
export { FORBIDDEN_SECRET_KEYS, findForbiddenSecrets } from './redaction.mjs';
