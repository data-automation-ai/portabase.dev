/**
 * Most-recent binary backup policy (product law).
 *
 * Port of:
 *   scripts/aws-latest-ebs-snapshot.ps1
 *   scripts/export-aws-binary-backups-to-dropbox.ps1
 *   scripts/export-binary-backups-interactive.ps1
 *
 * ALWAYS the most recent completed EBS snapshot / AMI / S3 series object.
 * Never a hand-picked older backup unless ForceOverride is loud and explicit.
 * Tag filter PortabaseBackup=true where applicable.
 *
 * This module is fixture/in-memory only. It does not call AWS and does not
 * create snapshots, AMIs, or store-image tasks.
 */

export const LATEST_BACKUP_POLICY = Object.freeze({
  name: 'most_recent',
  tagKey: 'PortabaseBackup',
  tagValue: 'true',
  requireCompleted: true,
  refusePinnedWithoutForceOverride: true,
  amiMustBeAvailable: true,
  amiRootDeviceType: 'ebs',
  amiMustBePrivate: true,
  criticalAmiPrefixes: Object.freeze(['capece-daily-', 'combo-auto-', 'portabase-']),
  s3BackupBuckets: Object.freeze([
    'capece-supabase-backups',
    'dbasebackups',
    'dataautomation-emergency-backups',
    'dataautomation-ai-backups',
    'capece-backup-deploy-899867382621',
  ]),
  exportBucket: 'aws-binary-dr-exports-899867382621',
  neverStageOnC: true,
});

export class PinnedBackupRefusedError extends Error {
  constructor(id, kind = 'snapshot') {
    super(
      `Refusing pinned ${kind} ${id} without ForceOverride. Policy: always use most recent backup.`,
    );
    this.name = 'PinnedBackupRefusedError';
    this.pinnedId = id;
    this.kind = kind;
    this.code = 'PINNED_BACKUP_REFUSED';
  }
}

export function tagMap(resource) {
  const tags = resource?.Tags ?? resource?.tags ?? {};
  if (Array.isArray(tags)) {
    const map = {};
    for (const tag of tags) {
      if (tag?.Key) map[tag.Key] = tag.Value;
    }
    return map;
  }
  return { ...tags };
}

export function hasTag(resource, key, value) {
  return tagMap(resource)[key] === value;
}

export function hasPortabaseBackupTag(resource, options = {}) {
  const key = options.tagKey ?? LATEST_BACKUP_POLICY.tagKey;
  const value = options.tagValue ?? LATEST_BACKUP_POLICY.tagValue;
  return hasTag(resource, key, value);
}

export function parseBackupTime(resource) {
  const raw =
    resource?.StartTime
    || resource?.startTime
    || resource?.CreationDate
    || resource?.creationDate
    || resource?.LastModified
    || resource?.lastModified
    || null;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

export function isCompletedSnapshot(snapshot) {
  const state = String(snapshot?.State || snapshot?.state || snapshot?.Status || snapshot?.status || 'completed')
    .toLowerCase();
  return state === 'completed';
}

export function isAvailablePrivateEbsAmi(image) {
  const state = String(image?.State || image?.state || '').toLowerCase();
  const root = String(image?.RootDeviceType || image?.rootDeviceType || 'ebs').toLowerCase();
  const isPublic = image?.Public === true || image?.isPublic === true;
  return state === 'available' && root === LATEST_BACKUP_POLICY.amiRootDeviceType && isPublic !== true;
}

function snapshotIdOf(snapshot) {
  return snapshot?.SnapshotId || snapshot?.snapshotId || null;
}

function volumeIdOf(snapshotOrVolume) {
  return snapshotOrVolume?.VolumeId || snapshotOrVolume?.volumeId || snapshotOrVolume?.id || null;
}

function imageIdOf(image) {
  return image?.ImageId || image?.imageId || image?.id || null;
}

function sortNewestFirst(items) {
  return [...items].sort((a, b) => parseBackupTime(b) - parseBackupTime(a));
}

/**
 * Select the newest completed snapshot from a pool.
 * @param {object[]} snapshots
 * @param {{ volumeId?: string, applyTagFilter?: boolean|'where-applicable', tagKey?: string, tagValue?: string }} [options]
 * @returns {object|null}
 */
export function selectMostRecentCompletedSnapshot(snapshots, options = {}) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  let pool = list.filter(isCompletedSnapshot);
  if (options.volumeId) {
    pool = pool.filter((snap) => volumeIdOf(snap) === options.volumeId);
  }

  const tagKey = options.tagKey ?? LATEST_BACKUP_POLICY.tagKey;
  const tagValue = options.tagValue ?? LATEST_BACKUP_POLICY.tagValue;
  const mode = options.applyTagFilter ?? 'where-applicable';
  const tagged = pool.filter((snap) => hasTag(snap, tagKey, tagValue));

  if (mode === true) {
    pool = tagged;
  } else if (mode === 'where-applicable' && tagged.length) {
    pool = tagged;
  }

  const newest = sortNewestFirst(pool)[0] || null;
  return newest || null;
}

/**
 * PowerShell-parity resolver for one volume (or account-wide latest).
 *
 * @param {object[]} snapshots
 * @param {{
 *   volumeId?: string,
 *   snapshotId?: string,
 *   forceOverride?: boolean,
 *   applyTagFilter?: boolean|'where-applicable',
 *   tagKey?: string,
 *   tagValue?: string,
 *   strict?: boolean,
 * }} [options]
 */
export function resolveLatestEbsSnapshot(snapshots, options = {}) {
  const pinned = options.snapshotId || options.SnapshotId || '';
  if (pinned && !options.forceOverride && !options.ForceOverride) {
    throw new PinnedBackupRefusedError(pinned, 'snapshot');
  }

  if (pinned && (options.forceOverride || options.ForceOverride)) {
    const found = (snapshots || []).find((snap) => snapshotIdOf(snap) === pinned);
    if (!found) {
      throw new Error(`Snapshot not found: ${pinned}`);
    }
    return {
      policy: 'override',
      snapshotId: snapshotIdOf(found),
      startTime: found.StartTime || found.startTime || null,
      volumeId: volumeIdOf(found),
      state: found.State || found.state || null,
      volumeSize: found.VolumeSize || found.volumeSize || found.sizeGiB || null,
      warning: 'FORCED_OVERRIDE_not_most_recent',
      source: found,
    };
  }

  const newest = selectMostRecentCompletedSnapshot(snapshots, options);
  if (!newest) {
    if (options.strict) {
      const vol = options.volumeId ? `, volume ${options.volumeId}` : '';
      throw new Error(
        `No completed EBS snapshots matched filters (tag ${options.tagKey || LATEST_BACKUP_POLICY.tagKey}=${options.tagValue || LATEST_BACKUP_POLICY.tagValue}${vol}).`,
      );
    }
    return {
      policy: 'most_recent',
      snapshotId: null,
      startTime: null,
      volumeId: options.volumeId || null,
      state: null,
      reason: 'no-completed-snapshot',
      source: null,
    };
  }

  return {
    policy: 'most_recent',
    snapshotId: snapshotIdOf(newest),
    startTime: newest.StartTime || newest.startTime || null,
    volumeId: volumeIdOf(newest),
    state: newest.State || newest.state || 'completed',
    volumeSize: newest.VolumeSize || newest.volumeSize || newest.sizeGiB || null,
    description: newest.Description || newest.description || null,
    tagged: hasPortabaseBackupTag(newest, options),
    source: newest,
  };
}

/**
 * Most recent available private EBS AMI matching a name prefix.
 */
export function selectMostRecentAmi(images, options = {}) {
  const prefix = options.namePrefix || options.AmiNamePrefix || '';
  let pool = (images || []).filter(isAvailablePrivateEbsAmi);
  if (prefix) {
    pool = pool.filter((image) => String(image.Name || image.name || '').startsWith(prefix));
  }
  const tagKey = options.tagKey ?? LATEST_BACKUP_POLICY.tagKey;
  const tagValue = options.tagValue ?? LATEST_BACKUP_POLICY.tagValue;
  const mode = options.applyTagFilter ?? 'where-applicable';
  const tagged = pool.filter((image) => hasTag(image, tagKey, tagValue));
  if (mode === true) pool = tagged;
  else if (mode === 'where-applicable' && tagged.length) pool = tagged;
  return sortNewestFirst(pool)[0] || null;
}

export function resolveLatestAmi(images, options = {}) {
  const pinned = options.imageId || options.ImageId || '';
  if (pinned && !options.forceOverride && !options.ForceOverride) {
    throw new PinnedBackupRefusedError(pinned, 'ami');
  }
  if (pinned && (options.forceOverride || options.ForceOverride)) {
    const found = (images || []).find((image) => imageIdOf(image) === pinned);
    if (!found) throw new Error(`AMI not found: ${pinned}`);
    return {
      policy: 'override',
      amiId: imageIdOf(found),
      name: found.Name || found.name || null,
      creationDate: found.CreationDate || found.creationDate || null,
      rootDevice: found.RootDeviceType || found.rootDeviceType || null,
      snapshotId: found.SnapshotIds?.[0] || found.BlockDeviceMappings?.[0]?.Ebs?.SnapshotId || null,
      warning: 'FORCED_OVERRIDE_not_most_recent',
      source: found,
    };
  }

  const newest = selectMostRecentAmi(images, options);
  if (!newest) {
    if (options.strict) throw new Error('No matching EBS AMIs found.');
    return {
      policy: 'most_recent',
      amiId: null,
      name: null,
      reason: 'no-available-ami',
      prefix: options.namePrefix || null,
      source: null,
    };
  }
  return {
    policy: 'most_recent',
    amiId: imageIdOf(newest),
    name: newest.Name || newest.name || null,
    creationDate: newest.CreationDate || newest.creationDate || null,
    rootDevice: newest.RootDeviceType || newest.rootDeviceType || 'ebs',
    snapshotId: newest.SnapshotIds?.[0] || newest.BlockDeviceMappings?.[0]?.Ebs?.SnapshotId || null,
    prefix: options.namePrefix || null,
    tagged: hasPortabaseBackupTag(newest, options),
    source: newest,
  };
}

export function resolveLatestAmisByPrefixes(images, prefixes = LATEST_BACKUP_POLICY.criticalAmiPrefixes, options = {}) {
  return (prefixes || []).map((prefix) => resolveLatestAmi(images, { ...options, namePrefix: prefix }))
    .filter((row) => row.amiId);
}

/**
 * Strip date-ish tokens so nightly/db-20260731-0700.dump shares a series
 * with nightly/db-20260801-0700.dump. Port of Get-SeriesKey.
 */
export function seriesKey(bucket, key) {
  let series = String(key || '').replace(/\\/g, '/');
  series = series.replace(/\d{8}T\d{6}Z/g, '{DATE}');
  series = series.replace(/\d{8}[_-]\d{4,6}/g, '{DATE}');
  series = series.replace(/\d{4}-\d{2}-\d{2}([_T-]\d{2}([:-]\d{2}){1,2}Z?)?/g, '{DATE}');
  series = series.replace(/LCMD_DB_Backup_\d{8}_\d{4}/g, 'LCMD_DB_Backup_{DATE}');
  series = series.replace(/\d{8}/g, '{DATE}');
  series = series.replace(/\d{10,}/g, '{TS}');
  return `${bucket}::${series}`;
}

export function isCriticalRollingBinary(key) {
  const k = String(key || '').replace(/\\/g, '/');
  if (/\.(dump|bak|sql|sql\.gz|sql\.bz2)(\.sha256)?$/i.test(k)) return true;
  if (/LCMD_DB_Backup_/i.test(k)) return true;
  if (/\/(nightly|daily|weekly)\//i.test(k)) return true;
  if (/(postgres|mysql|mongo).*\.(dump|bak|sql)/i.test(k)) return true;
  if (/(clawd_backup|hermes_backup|dataautomation_backup|hermes_essential|clawd_websites).*\.(tar\.gz|tgz|zip)$/i.test(k)) {
    return true;
  }
  if (/^[^/]+\.(tar\.gz|tgz)$/i.test(k) && /backup/i.test(k)) return true;
  return false;
}

/**
 * Default picker: only the most recent object per series.
 * Port of export-binary-backups-interactive.ps1 (IncludeAllInSeries off).
 */
export function selectMostRecentPerSeries(objects, options = {}) {
  const includeAll = Boolean(options.includeAllInSeries);
  const criticalOnly = options.criticalRolling !== false;
  const rows = [];
  for (const obj of objects || []) {
    const bucket = obj.Bucket || obj.bucket;
    const key = obj.Key || obj.key;
    if (!bucket || !key || String(key).endsWith('/')) continue;
    if (criticalOnly && !isCriticalRollingBinary(key)) continue;
    rows.push({
      bucket,
      key,
      sizeBytes: Number(obj.Size || obj.SizeBytes || obj.sizeBytes || 0),
      lastModified: obj.LastModified || obj.lastModified || null,
      lastModifiedMs: parseBackupTime(obj),
      series: seriesKey(bucket, key),
      isCritical: isCriticalRollingBinary(key),
      isMostRecent: false,
    });
  }

  const bySeries = new Map();
  for (const row of rows) {
    const list = bySeries.get(row.series) || [];
    list.push(row);
    bySeries.set(row.series, list);
  }
  const latest = [];
  for (const list of bySeries.values()) {
    const ordered = [...list].sort((a, b) => b.lastModifiedMs - a.lastModifiedMs);
    ordered[0].isMostRecent = true;
    latest.push(ordered[0]);
  }

  const selected = includeAll ? rows : latest;
  return {
    policy: 'most_recent_per_series',
    seriesCount: bySeries.size,
    selected,
    ignoredOlder: includeAll ? [] : rows.filter((row) => !row.isMostRecent),
  };
}

export function collectS3ObjectsFromFixture(fixture) {
  const out = [];
  for (const bucket of fixture?.s3?.buckets || []) {
    for (const obj of bucket.objects || []) {
      out.push({
        Bucket: bucket.Name,
        Key: obj.Key,
        Size: obj.Size ?? obj.SizeBytes,
        LastModified: obj.LastModified,
      });
    }
  }
  return out;
}

/**
 * Resolve latest completed backups for every volume, critical AMI series, and S3 series.
 * Prefer existing latest snaps. Do not invent snapshot ids.
 */
export function resolveAccountLatestBackups(input = {}, options = {}) {
  const snapshots = input.snapshots || [];
  const images = input.images || [];
  const volumes = input.volumes || [];
  const s3Objects = input.s3Objects || [];
  const prefixes = options.amiPrefixes || LATEST_BACKUP_POLICY.criticalAmiPrefixes;

  const volumeRows = volumes.map((volume) => {
    const volumeId = volume.VolumeId || volume.id;
    const pinned = options.pins?.[volumeId] || volume.PinnedSnapshotId || null;
    const force = Boolean(options.forceOverride || volume.ForceOverride);

    if (pinned && !force) {
      const latest = resolveLatestEbsSnapshot(snapshots, {
        volumeId,
        applyTagFilter: options.applyTagFilter ?? 'where-applicable',
        strict: false,
      });
      return {
        volumeId,
        ...latest,
        pinnedSnapshotId: pinned,
        pinnedRefused: latest.snapshotId !== pinned,
        warning: latest.snapshotId && latest.snapshotId !== pinned
          ? 'PINNED_OLDER_SNAPSHOT_REFUSED — using most recent completed'
          : latest.snapshotId
            ? null
            : latest.reason,
      };
    }

    const resolved = resolveLatestEbsSnapshot(snapshots, {
      volumeId,
      snapshotId: pinned || undefined,
      forceOverride: force,
      applyTagFilter: options.applyTagFilter ?? 'where-applicable',
      strict: false,
    });
    return { volumeId, ...resolved, pinnedSnapshotId: pinned || null, pinnedRefused: false };
  });

  const amiRows = resolveLatestAmisByPrefixes(images, prefixes, {
    applyTagFilter: options.applyTagFilter ?? 'where-applicable',
  });

  const s3 = selectMostRecentPerSeries(s3Objects, {
    includeAllInSeries: options.includeAllInSeries,
    criticalRolling: options.criticalRolling,
  });

  return {
    policy: LATEST_BACKUP_POLICY.name,
    tagFilter: {
      key: LATEST_BACKUP_POLICY.tagKey,
      value: LATEST_BACKUP_POLICY.tagValue,
      mode: options.applyTagFilter ?? 'where-applicable',
    },
    volumes: volumeRows,
    amis: amiRows,
    s3Series: s3,
    neverHoldsBytes: true,
  };
}

export function latestForVolume(latestBackups, volumeId) {
  return (latestBackups?.volumes || []).find((row) => row.volumeId === volumeId) || null;
}

export function powershellLatestSnapshotCommand(options = {}) {
  const parts = ['powershell', '-File', 'scripts/aws-latest-ebs-snapshot.ps1'];
  if (options.region) parts.push('-Region', options.region);
  if (options.volumeId) parts.push('-VolumeId', options.volumeId);
  if (options.asAmi) parts.push('-AsAmi');
  if (options.snapshotId) parts.push('-SnapshotId', options.snapshotId);
  if (options.forceOverride) parts.push('-ForceOverride');
  parts.push('-Json');
  return parts.join(' ');
}

export function powershellBinaryExportCommand(options = {}) {
  if (options.interactive === false) {
    const parts = ['powershell', '-File', 'scripts/export-aws-binary-backups-to-dropbox.ps1'];
    if (options.skipAmiExport) parts.push('-SkipAmiExport');
    if (options.skipS3Sync) parts.push('-SkipS3Sync');
    if (options.testMode) parts.push('-TestMode');
    return parts.join(' ');
  }
  const parts = ['powershell', '-File', 'scripts/export-binary-backups-interactive.ps1'];
  if (options.listOnly !== false) parts.push('-ListOnly');
  if (options.alsoAmiImages) parts.push('-AlsoAmiImages');
  if (options.whatIf) parts.push('-WhatIf');
  return parts.join(' ');
}
