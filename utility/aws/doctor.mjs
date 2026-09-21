/**
 * AWS doctor report — will-copy / will-warn / will-fail.
 * Never claims MATCH or proven. This scaffold does not run a restore drill.
 */

import { decideAll } from './binary-decision.mjs';
import { COST_SIGNALS, estimateMonthlyUsd } from './cost-signals.mjs';
import { estimateScriptedBytes, sumBinaryGiB } from './inventory.mjs';
import { buildCapsulePackageShape, recoverTxt } from './package-shape.mjs';
import { emptySecretsPolicy, unprovenCoverage, validateAwsCapsuleManifest } from './schema.mjs';
import {
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_CAPSULE_KIND,
  AWS_DEFAULT_PROFILE,
  AWS_INVENTORY_SCHEMA_VERSION,
} from './versions.mjs';

const SNAPSHOT_RATE = {
  'AWS::EC2::Volume': 'ebsSnapshotGiBMonth',
  'AWS::EC2::Snapshot': 'ebsSnapshotGiBMonth',
  'AWS::S3::ObjectBody': 's3StandardGiBMonth',
  'AWS::RDS::DBInstance': 'rdsBackupGiBMonth',
  'AWS::RDS::DBCluster': 'rdsBackupGiBMonth',
  'AWS::ECR::Image': 'ecrStorageGiBMonth',
};

/**
 * @param {object} inventory from buildInventory()
 * @param {{ createdAt?: string, portabaseVersion?: string }} [options]
 */
export function buildDoctorReport(inventory, options = {}) {
  if (!inventory?.account?.accountId) {
    throw new Error('doctor requires an inventory with account.accountId');
  }
  const decided = decideAll(inventory.resources);
  const findings = decided.map(({ resource, decision }) => {
    const rateKey = SNAPSHOT_RATE[resource.resourceClass];
    const cost = rateKey ? estimateMonthlyUsd(resource.sizeGiB, rateKey) : null;
    return {
      severity: decision.finding,
      code: findingCode(resource.resourceClass, decision),
      resourceClass: resource.resourceClass,
      resourceId: resource.id,
      region: resource.region || null,
      sizeGiB: Number(resource.sizeGiB) || 0,
      encryption: resource.encryption || null,
      message: decision.reason,
      coverage: decision.coverage,
      action: decision.action,
      recommendedPath: decision.recommendedPath,
      restoreBlockers: decision.restoreBlockers,
      inCapsule: decision.inCapsule,
      costSignal: cost,
      notCovered: decision.coverage === 'excluded' || decision.coverage === 'blocked',
    };
  });

  const counts = { 'will-copy': 0, 'will-warn': 0, 'will-fail': 0 };
  for (const finding of findings) counts[finding.severity] += 1;

  const scriptedEstimateBytes = estimateScriptedBytes(inventory);
  const binaryFootprintGiB = Math.round(sumBinaryGiB(inventory) * 1000) / 1000;
  const snapshotHint = estimateMonthlyUsd(binaryFootprintGiB, 'ebsSnapshotGiBMonth');

  const scripted = {};
  const binaryReferences = {
    ebsSnapshots: [],
    rdsSnapshots: [],
    amis: [],
    ecrImages: [],
    excludedBinaries: [],
  };

  for (const { resource, decision } of decided) {
    if (decision.inCapsule && resource.scriptedPayload) {
      const key = resource.resourceClass;
      if (!scripted[key]) scripted[key] = [];
      scripted[key].push(resource.scriptedPayload);
    }
    if (decision.action === 'recommend-snapshot') {
      const snapshotId = resource.latestSnapshotId || resource.recommendedSnapshotId || resource.snapshotId || null;
      binaryReferences.ebsSnapshots.push({
        volumeId: resource.id,
        snapshotId,
        region: resource.region,
        sizeGiB: resource.sizeGiB,
        encrypted: resource.encryption?.encrypted ?? null,
        policy: resource.latestBackupPolicy || 'most_recent',
        startTime: resource.latestSnapshotStartTime || null,
        pinnedRefused: Boolean(resource.pinnedRefused),
        status: snapshotId ? 'referenced-latest-completed' : 'recommended-not-created',
      });
    }
    if (decision.action === 'recommend-rds-snapshot') {
      binaryReferences.rdsSnapshots.push({
        dbId: resource.id,
        snapshotId: resource.snapshotId || null,
        region: resource.region,
        allocatedGiB: resource.sizeGiB,
        status: resource.snapshotId ? 'referenced' : 'recommended-not-created',
      });
    }
    if (decision.action === 'recommend-ami') {
      binaryReferences.amis.push({
        imageId: resource.imageId || resource.id,
        region: resource.region,
        seriesPrefix: resource.seriesPrefix || null,
        isMostRecentInSeries: resource.isMostRecentInSeries !== false,
        latestImageIdInSeries: resource.latestImageIdInSeries || resource.imageId || null,
        policy: 'most_recent',
      });
    }
    if (decision.action === 'recommend-ecr-replication') {
      binaryReferences.ecrImages.push({
        id: resource.id,
        digest: resource.digest,
        tags: resource.tags || [],
        sizeGiB: resource.sizeGiB,
      });
    }
    if (decision.action === 'exclude-binaries') {
      binaryReferences.excludedBinaries.push({
        id: resource.id,
        resourceClass: resource.resourceClass,
        sizeGiB: resource.sizeGiB,
        label: 'NOT IN CAPSULE — binary excluded by default',
      });
    }
  }

  binaryReferences.latestPolicy = {
    name: inventory.latestBackups?.policy || 'most_recent',
    tagFilter: inventory.latestBackups?.tagFilter || { key: 'PortabaseBackup', value: 'true', mode: 'where-applicable' },
    neverHoldsBytes: true,
    s3Series: {
      seriesCount: inventory.latestBackups?.s3Series?.seriesCount || 0,
      selected: (inventory.latestBackups?.s3Series?.selected || []).map((row) => ({
        series: row.series,
        bucket: row.bucket,
        key: row.key,
        lastModified: row.lastModified,
        sizeBytes: row.sizeBytes,
      })),
    },
  };

  const manifest = {
    kind: AWS_CAPSULE_KIND,
    capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
    inventorySchemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
    profile: AWS_DEFAULT_PROFILE,
    createdAt: options.createdAt || new Date().toISOString(),
    portabaseVersion: options.portabaseVersion || null,
    account: inventory.account,
    regions: inventory.regions,
    scripted,
    binaryReferences,
    measurement: {
      scriptedEstimateBytes,
      binaryFootprintGiB,
      resourceCount: inventory.resources.length,
      edgeCount: inventory.edges.length,
      costSignals: {
        ...COST_SIGNALS,
        binaryFootprintMonthlyHint: snapshotHint,
      },
    },
    coverage: unprovenCoverage({
      scriptedComplete: counts['will-fail'] === 0,
    }),
    secretsPolicy: emptySecretsPolicy(),
    findings,
  };

  validateAwsCapsuleManifest(manifest);

  return {
    command: 'aws doctor',
    counts,
    exitCode: counts['will-fail'] > 0 ? 2 : 0,
    inventorySchemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
    capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
    edges: inventory.edges,
    proven: false,
    match: false,
    latestBackups: inventory.latestBackups || null,
    packageShape: buildCapsulePackageShape(manifest, { sealed: false, checksums: false }),
    recoverTxt: recoverTxt(),
    loudLabels: loudLabels(findings, binaryFootprintGiB, scriptedEstimateBytes),
    manifest,
  };
}

function findingCode(resourceClass, decision) {
  const short = String(resourceClass || 'UNKNOWN').split('::').pop().replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  const action = String(decision.action || 'unknown').replace(/-/g, '_').toUpperCase();
  return `${short}_${action}`;
}

function loudLabels(findings, binaryGiB, scriptedBytes) {
  const labels = [
    'NOT PROVEN — no AWS restore drill exists',
    'MATCH is false',
    `SCRIPT vs BINARY: ~${scriptedBytes} bytes of config vs ~${binaryGiB} GiB binary footprint (binaries not in .pbase)`,
  ];
  if (findings.some((f) => f.coverage === 'excluded')) {
    labels.push('NOT COVERED: one or more binaries are excluded from the capsule by default');
  }
  if (findings.some((f) => f.restoreBlockers?.includes('instance-store-ephemeral'))) {
    labels.push('RESTORE BLOCKER: instance store volumes cannot be snapshotted');
  }
  if (findings.some((f) => f.restoreBlockers?.includes('no-approved-snapshot'))) {
    labels.push('EBS: no completed recent snapshot — CreateSnapshot recommended only after latest-resolve; this scaffold will not create it');
  }
  if (findings.some((f) => f.recommendedPath === 'reference-latest-completed-snapshot')) {
    labels.push('EBS: referencing most recent completed snapshot (not a pinned older snap; bytes not in .pbase)');
  }
  return labels;
}

export function formatDoctorText(report) {
  const lines = [
    `Portabase AWS doctor · capsule ${report.capsuleFormatVersion} · inventory ${report.inventorySchemaVersion}`,
    `Account ${report.manifest.account.accountId} · regions ${report.manifest.regions.join(', ')}`,
    `Findings  will-copy=${report.counts['will-copy']}  will-warn=${report.counts['will-warn']}  will-fail=${report.counts['will-fail']}`,
    '',
    ...report.loudLabels.map((label) => `!!  ${label}`),
    '',
  ];
  for (const finding of report.manifest.findings) {
    const size = finding.sizeGiB ? `  ${finding.sizeGiB} GiB` : '';
    lines.push(
      `${finding.severity.padEnd(10)} ${finding.code.padEnd(28)} ${finding.resourceId}${size}`,
    );
    lines.push(`           ${finding.message}`);
  }
  lines.push('');
  lines.push('This command is read-only. It does not create snapshots or call live AWS.');
  return lines.join('\n');
}
