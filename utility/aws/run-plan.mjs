/**
 * Scripted AWS capsule run plan.
 *
 * Given an inventory (with latest-backup resolution already bound), emit the
 * exact command sequence the operator / Combo must run:
 *
 *   inventory → doctor → latest-snapshot resolve → binary export → capsule seal
 *
 * Dry-run only. This module never calls AWS, never creates snapshots, and
 * never stages hundreds of GB on C:. Mutating steps are printed as gated
 * operator commands and marked blocked until an explicit future --live.
 */

import { AWS_PACKAGE_FILES } from './package-shape.mjs';
import {
  LATEST_BACKUP_POLICY,
  powershellBinaryExportCommand,
  powershellLatestSnapshotCommand,
} from './latest-backup.mjs';
import { RUNNER_AWS_AUTH_MODES } from './runner-auth.mjs';
import {
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_INVENTORY_SCHEMA_VERSION,
} from './versions.mjs';

export const AWS_RUN_PLAN_KIND = 'portabase-aws-run-plan';
export const AWS_RUN_PLAN_VERSION = '1.0.0';

function fixtureFlag(fixturePath) {
  return fixturePath ? `--fixture ${fixturePath}` : '--fixture <account.json>';
}

/**
 * @param {object} inventory from buildInventory()
 * @param {{ fixturePath?: string, region?: string, outMd?: string, runnerAuth?: object }} [options]
 */
export function buildAwsRunPlan(inventory, options = {}) {
  if (!inventory?.account?.accountId) {
    throw new Error('buildAwsRunPlan requires an inventory with account.accountId');
  }
  const latest = inventory.latestBackups || {
    policy: LATEST_BACKUP_POLICY.name,
    volumes: [],
    amis: [],
    s3Series: { selected: [], ignoredOlder: [], seriesCount: 0 },
  };
  const region = options.region || inventory.regions?.[0] || 'us-east-1';
  const fixture = fixtureFlag(options.fixturePath);
  const runnerAuth = options.runnerAuth || {
    mode: RUNNER_AWS_AUTH_MODES.FIXTURE,
    ok: true,
    note: 'Plan assumes the operator/Combo runner has local AWS access.',
  };
  const volumesNeedingSnapshot = (latest.volumes || []).filter((row) => !row.snapshotId);
  const volumesWithLatest = (latest.volumes || []).filter((row) => row.snapshotId);
  const amis = latest.amis || [];
  const s3Selected = latest.s3Series?.selected || [];

  const steps = [
    {
      id: 'inventory',
      phase: 'inventory',
      title: 'Script account objects into inventory',
      mutate: false,
      blocked: false,
      tool: 'node',
      commands: [`node utility/portabase.mjs aws inventory ${fixture}`],
      notes: [
        'Read-only. Scripted JSON is a capsule candidate. Binaries are inventoried, not dumped.',
        'Runs ON the customer runner with the standard AWS credential chain (instance role preferred).',
        'Portabase never holds sealing keys, AWS keys, or capsule bytes.',
      ],
      runnerCommands: [
        '# ambient AWS_PROFILE / instance role on this runner — fail closed if missing',
        'node utility/portabase.mjs aws inventory --require-aws',
      ],
    },
    {
      id: 'doctor',
      phase: 'doctor',
      title: 'will-copy / will-warn / will-fail against SIZE_POLICY',
      mutate: false,
      blocked: false,
      tool: 'node',
      commands: [`node utility/portabase.mjs aws doctor ${fixture}`],
      notes: [
        'Never claims MATCH or proven.',
        'Prefers an existing most-recent completed snapshot over CreateSnapshot.',
      ],
    },
    {
      id: 'latest-snapshot-resolve',
      phase: 'latest-snapshot-resolve',
      title: 'Resolve most recent completed EBS snapshot / AMI per series',
      mutate: false,
      blocked: false,
      tool: 'node+powershell',
      commands: [
        `node utility/portabase.mjs aws plan ${fixture} --json`,
        ...volumesWithLatest.map((row) =>
          powershellLatestSnapshotCommand({ region, volumeId: row.volumeId }),
        ),
        ...amis.map((row) =>
          powershellLatestSnapshotCommand({ region, asAmi: true }),
        ).slice(0, 1),
      ],
      resolved: {
        volumes: volumesWithLatest.map((row) => ({
          volumeId: row.volumeId,
          snapshotId: row.snapshotId,
          startTime: row.startTime,
          policy: row.policy,
          tagged: Boolean(row.tagged),
        })),
        amis: amis.map((row) => ({
          prefix: row.prefix,
          amiId: row.amiId,
          name: row.name,
          creationDate: row.creationDate,
          policy: row.policy,
        })),
      },
      notes: [
        'Policy: ALWAYS most recent completed backup.',
        'Pinned older SnapshotId is refused without loud ForceOverride.',
        'Tag filter PortabaseBackup=true where applicable.',
        'This step only resolves IDs. It does not call CreateSnapshot.',
      ],
    },
    {
      id: 'binary-export-s3',
      phase: 'binary-export',
      title: 'S3 backup series — most recent object per series only',
      mutate: false,
      blocked: false,
      tool: 'powershell',
      commands: [powershellBinaryExportCommand({ listOnly: true })],
      resolved: {
        seriesCount: latest.s3Series?.seriesCount || 0,
        selected: s3Selected.map((row) => ({
          series: row.series,
          bucket: row.bucket,
          key: row.key,
          lastModified: row.lastModified,
          sizeBytes: row.sizeBytes,
        })),
        ignoredOlderCount: latest.s3Series?.ignoredOlder?.length || 0,
      },
      notes: [
        'Default is only the most recent object per series (not every historical dump).',
        'Production copy is rclone S3 → Dropbox. Never stage hundreds of GB on C:.',
        'ListOnly / WhatIf stay dry-run. Upload requires a later operator YES.',
      ],
    },
    {
      id: 'binary-export-ami',
      phase: 'binary-export',
      title: 'AMI store-image for latest critical AMIs (gated)',
      mutate: true,
      blocked: true,
      tool: 'powershell',
      commands: amis.map((row) =>
        `aws ec2 create-store-image-task --region ${region} --image-id ${row.amiId} --bucket ${LATEST_BACKUP_POLICY.exportBucket}`,
      ),
      operatorScripts: [
        powershellBinaryExportCommand({ listOnly: true, alsoAmiImages: true }),
        'powershell -File scripts/export-aws-binary-backups-to-dropbox.ps1',
      ],
      resolved: { amis },
      notes: [
        'CreateStoreImageTask is a mutation. This scaffold prints it and will not run it.',
        'Blocked until Louis explicitly enables --live on Combo.',
        'Use the most recent available private EBS AMI per critical prefix only.',
        'AMI .bin objects can be 100+ GiB — rclone from the export bucket, not C: spool.',
      ],
    },
    {
      id: 'create-snapshot-if-missing',
      phase: 'latest-snapshot-resolve',
      title: 'CreateSnapshot only when no completed recent snap exists (gated)',
      mutate: true,
      blocked: true,
      tool: 'aws-cli',
      commands: volumesNeedingSnapshot.map((row) =>
        `aws ec2 create-snapshot --region ${region} --volume-id ${row.volumeId} --description "Portabase most-recent backup" --tag-specifications 'ResourceType=snapshot,Tags=[{Key=PortabaseBackup,Value=true}]'`,
      ),
      notes: [
        'Prefer referencing an existing latest completed snapshot. Do not invent one in this PR.',
        volumesNeedingSnapshot.length
          ? `${volumesNeedingSnapshot.length} volume(s) have no completed snapshot — operator must create later.`
          : 'Every inventoried volume already has a most-recent completed snapshot to reference.',
        'This CLI refuses --live / --snapshot / --create-snapshot / --mutate / --execute.',
      ],
    },
    {
      id: 'capsule-seal',
      phase: 'capsule-seal',
      title: 'Seal scripted JSON + binary references (not bytes) into customer-owned capsule',
      mutate: false,
      blocked: true,
      tool: 'node',
      commands: [
        `# not implemented — future: node utility/portabase.mjs aws seal ${fixture}`,
      ],
      packageFiles: { ...AWS_PACKAGE_FILES },
      notes: [
        'Same escape-package files as Supabase: capsule.json, capsule.pbase, checksums.sha256, RECOVER.txt.',
        'Capsule stores most-recent backup IDs. Portabase never holds the bytes.',
        'Seal stays unimplemented in this read-only scaffold.',
      ],
    },
  ];

  return {
    kind: AWS_RUN_PLAN_KIND,
    version: AWS_RUN_PLAN_VERSION,
    dryRun: true,
    mutate: false,
    policy: LATEST_BACKUP_POLICY.name,
    capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
    inventorySchemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
    account: inventory.account,
    regions: inventory.regions,
    proven: false,
    match: false,
    neverHoldsBytes: true,
    neverHoldsAwsKeys: true,
    neverStageOnC: LATEST_BACKUP_POLICY.neverStageOnC,
    runnerAuth,
    runnerLocalAws: true,
    steps,
    summary: {
      volumeLatestCount: volumesWithLatest.length,
      volumeMissingSnapshotCount: volumesNeedingSnapshot.length,
      amiLatestCount: amis.length,
      s3SeriesLatestCount: s3Selected.length,
      gatedMutations: steps.filter((step) => step.blocked && step.mutate).map((step) => step.id),
    },
  };
}

export function formatAwsRunPlanText(plan) {
  const lines = [
    `Portabase AWS run plan · ${plan.version} · dry-run`,
    `Account ${plan.account.accountId} · regions ${(plan.regions || []).join(', ')}`,
    `Policy: ${plan.policy} completed backups. Portabase never holds the bytes.`,
    `Runner AWS: mode=${plan.runnerAuth?.mode || 'fixture'} · credentials stay on this runner.`,
    'MATCH is false. NOT PROVEN. This plan does not mutate AWS.',
    '',
  ];
  for (const step of plan.steps) {
    const gate = step.blocked ? 'BLOCKED' : step.mutate ? 'MUTATE' : 'DRY-RUN';
    lines.push(`${step.id.padEnd(28)} [${gate}]  ${step.title}`);
    for (const command of step.commands || []) {
      if (command) lines.push(`    $ ${command}`);
    }
    for (const note of step.notes || []) {
      lines.push(`    · ${note}`);
    }
    lines.push('');
  }
  lines.push(
    `Latest refs: volumes=${plan.summary.volumeLatestCount}  missing-snap=${plan.summary.volumeMissingSnapshotCount}  amis=${plan.summary.amiLatestCount}  s3-series=${plan.summary.s3SeriesLatestCount}`,
  );
  return lines.join('\n');
}

export function formatAwsRunPlanMarkdown(plan) {
  const lines = [
    '# AWS capsule run plan',
    '',
    `**Kind:** \`${plan.kind}\` · **version** ${plan.version} · **dry-run**`,
    '',
    `- Account: \`${plan.account.accountId}\``,
    `- Regions: ${(plan.regions || []).join(', ')}`,
    `- Policy: **most recent completed backups** (\`${plan.policy}\`)`,
    '- Portabase never holds sealing keys, AWS keys, or capsule bytes.',
    '- Client runner uses the standard AWS credential chain (instance role preferred). Fail closed if missing.',
    '- Never stage hundreds of GB on C:. Use a cloud runner + rclone S3 → Dropbox.',
    '- MATCH is false. NOT PROVEN.',
    '- Mutating steps are printed and **blocked** until an explicit future `--live`.',
    '',
    '## Sequence',
    '',
  ];
  plan.steps.forEach((step, index) => {
    const gate = step.blocked ? 'blocked' : 'dry-run';
    lines.push(`### ${index + 1}. ${step.title}`);
    lines.push('');
    lines.push(`Phase \`${step.phase}\` · tool \`${step.tool}\` · ${gate}${step.mutate ? ' · would-mutate' : ''}`);
    lines.push('');
    if (step.commands?.length) {
      lines.push('```text');
      for (const command of step.commands) {
        if (command) lines.push(command);
      }
      lines.push('```');
      lines.push('');
    }
    for (const note of step.notes || []) {
      lines.push(`- ${note}`);
    }
    lines.push('');
  });
  lines.push('## Latest binary references (IDs only)');
  lines.push('');
  const resolve = plan.steps.find((step) => step.id === 'latest-snapshot-resolve')?.resolved;
  for (const row of resolve?.volumes || []) {
    lines.push(`- EBS \`${row.volumeId}\` → \`${row.snapshotId}\` (${row.startTime || 'time unknown'}) policy=${row.policy}`);
  }
  for (const row of resolve?.amis || []) {
    lines.push(`- AMI prefix \`${row.prefix}\` → \`${row.amiId}\` ${row.name || ''}`);
  }
  const s3 = plan.steps.find((step) => step.id === 'binary-export-s3')?.resolved;
  for (const row of s3?.selected || []) {
    lines.push(`- S3 \`${row.series}\` → \`s3://${row.bucket}/${row.key}\``);
  }
  if (!resolve?.volumes?.length && !resolve?.amis?.length && !s3?.selected?.length) {
    lines.push('- (none resolved from this fixture)');
  }
  lines.push('');
  return lines.join('\n');
}
