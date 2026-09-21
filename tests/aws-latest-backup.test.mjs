import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LATEST_BACKUP_POLICY,
  PinnedBackupRefusedError,
  collectS3ObjectsFromFixture,
  isCriticalRollingBinary,
  resolveAccountLatestBackups,
  resolveLatestAmi,
  resolveLatestEbsSnapshot,
  selectMostRecentCompletedSnapshot,
  selectMostRecentPerSeries,
  seriesKey,
  buildInventory,
  RESOURCE_CLASS,
} from '../utility/aws/index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fixturePath = join(root, 'utility/aws/fixtures/sample-account.json');

async function loadFixture() {
  return JSON.parse(await readFile(fixturePath, 'utf8'));
}

test('LATEST_BACKUP_POLICY is most_recent with PortabaseBackup tag', () => {
  assert.equal(LATEST_BACKUP_POLICY.name, 'most_recent');
  assert.equal(LATEST_BACKUP_POLICY.tagKey, 'PortabaseBackup');
  assert.equal(LATEST_BACKUP_POLICY.tagValue, 'true');
  assert.equal(LATEST_BACKUP_POLICY.refusePinnedWithoutForceOverride, true);
  assert.equal(LATEST_BACKUP_POLICY.neverStageOnC, true);
});

test('selects most recent completed snapshot and ignores pending + older', () => {
  const snaps = [
    { SnapshotId: 'snap-old', VolumeId: 'vol-daily', State: 'completed', StartTime: '2026-01-01T00:00:00.000Z' },
    { SnapshotId: 'snap-new', VolumeId: 'vol-daily', State: 'completed', StartTime: '2026-09-01T12:00:00.000Z' },
    { SnapshotId: 'snap-pending', VolumeId: 'vol-daily', State: 'pending', StartTime: '2026-09-20T00:00:00.000Z' },
    { SnapshotId: 'snap-other', VolumeId: 'vol-other', State: 'completed', StartTime: '2026-09-21T00:00:00.000Z' },
  ];
  const newest = selectMostRecentCompletedSnapshot(snaps, { volumeId: 'vol-daily' });
  assert.equal(newest.SnapshotId, 'snap-new');
  const resolved = resolveLatestEbsSnapshot(snaps, { volumeId: 'vol-daily' });
  assert.equal(resolved.policy, 'most_recent');
  assert.equal(resolved.snapshotId, 'snap-new');
});

test('refuses pinned older snapshot without ForceOverride', () => {
  const snaps = [
    { SnapshotId: 'snap-old', VolumeId: 'vol-x', State: 'completed', StartTime: '2026-01-01T00:00:00.000Z' },
    { SnapshotId: 'snap-new', VolumeId: 'vol-x', State: 'completed', StartTime: '2026-09-01T00:00:00.000Z' },
  ];
  assert.throws(
    () => resolveLatestEbsSnapshot(snaps, { volumeId: 'vol-x', snapshotId: 'snap-old' }),
    (err) => err instanceof PinnedBackupRefusedError && /ForceOverride/.test(err.message),
  );
  const forced = resolveLatestEbsSnapshot(snaps, {
    volumeId: 'vol-x',
    snapshotId: 'snap-old',
    forceOverride: true,
  });
  assert.equal(forced.policy, 'override');
  assert.equal(forced.snapshotId, 'snap-old');
  assert.equal(forced.warning, 'FORCED_OVERRIDE_not_most_recent');
});

test('PortabaseBackup=true tag filter applies where tagged snaps exist', () => {
  const snaps = [
    {
      SnapshotId: 'snap-tagged-old',
      VolumeId: 'vol-tagged',
      State: 'completed',
      StartTime: '2026-08-01T00:00:00.000Z',
      Tags: [{ Key: 'PortabaseBackup', Value: 'true' }],
    },
    {
      SnapshotId: 'snap-untagged-new',
      VolumeId: 'vol-tagged',
      State: 'completed',
      StartTime: '2026-09-15T00:00:00.000Z',
    },
  ];
  const tagged = resolveLatestEbsSnapshot(snaps, { volumeId: 'vol-tagged', applyTagFilter: 'where-applicable' });
  assert.equal(tagged.snapshotId, 'snap-tagged-old');
  assert.equal(tagged.tagged, true);
  const unfiltered = resolveLatestEbsSnapshot(snaps, { volumeId: 'vol-tagged', applyTagFilter: false });
  assert.equal(unfiltered.snapshotId, 'snap-untagged-new');
});

test('latest AMI per critical prefix ignores pending and older', () => {
  const images = [
    { ImageId: 'ami-old', Name: 'capece-daily-20260101', State: 'available', RootDeviceType: 'ebs', Public: false, CreationDate: '2026-01-01T00:00:00.000Z' },
    { ImageId: 'ami-new', Name: 'capece-daily-20260901', State: 'available', RootDeviceType: 'ebs', Public: false, CreationDate: '2026-09-01T00:00:00.000Z' },
    { ImageId: 'ami-pending', Name: 'capece-daily-20260920', State: 'pending', RootDeviceType: 'ebs', Public: false, CreationDate: '2026-09-20T00:00:00.000Z' },
    { ImageId: 'ami-public', Name: 'capece-daily-public', State: 'available', RootDeviceType: 'ebs', Public: true, CreationDate: '2026-09-21T00:00:00.000Z' },
  ];
  const latest = resolveLatestAmi(images, { namePrefix: 'capece-daily-' });
  assert.equal(latest.policy, 'most_recent');
  assert.equal(latest.amiId, 'ami-new');
  assert.throws(
    () => resolveLatestAmi(images, { imageId: 'ami-old' }),
    PinnedBackupRefusedError,
  );
});

test('S3 series key collapses dates; default picker is most recent per series', () => {
  assert.equal(
    seriesKey('capece-supabase-backups', 'nightly/db-20260731-0700.dump'),
    seriesKey('capece-supabase-backups', 'nightly/db-20260801-0700.dump'),
  );
  assert.equal(isCriticalRollingBinary('nightly/db-20260801-0700.dump'), true);
  assert.equal(isCriticalRollingBinary('notes/readme.txt'), false);

  const picked = selectMostRecentPerSeries([
    { Bucket: 'capece-supabase-backups', Key: 'nightly/db-20260731-0700.dump', Size: 10, LastModified: '2026-07-31T07:00:00.000Z' },
    { Bucket: 'capece-supabase-backups', Key: 'nightly/db-20260801-0700.dump', Size: 11, LastModified: '2026-08-01T07:00:00.000Z' },
    { Bucket: 'capece-supabase-backups', Key: 'notes/readme.txt', Size: 1, LastModified: '2026-09-01T00:00:00.000Z' },
  ]);
  assert.equal(picked.seriesCount, 1);
  assert.equal(picked.selected.length, 1);
  assert.equal(picked.selected[0].key, 'nightly/db-20260801-0700.dump');
  assert.equal(picked.ignoredOlder.length, 1);
});

test('fixture inventory binds most recent backup IDs and refuses a pinned older snap', async () => {
  const inventory = buildInventory(await loadFixture());
  const daily = inventory.resources.find((r) => r.id === 'vol-daily');
  assert.equal(daily.latestSnapshotId, 'snap-daily-new');
  assert.equal(daily.recommendedSnapshotId, 'snap-daily-new');
  assert.equal(daily.latestBackupPolicy, 'most_recent');

  const tagged = inventory.resources.find((r) => r.id === 'vol-tagged');
  assert.equal(tagged.latestSnapshotId, 'snap-tagged-old');

  const pinned = inventory.resources.find((r) => r.id === 'vol-pinned');
  assert.equal(pinned.latestSnapshotId, 'snap-pinned-new');
  assert.equal(pinned.pinnedRefused, true);
  assert.match(pinned.latestBackupWarning, /PINNED_OLDER_SNAPSHOT_REFUSED/);

  const missing = inventory.resources.find((r) => r.id === 'vol-111');
  assert.equal(missing.latestSnapshotId, null);

  const newestAmi = inventory.resources.find((r) => r.id === 'ami-capece-new');
  const olderAmi = inventory.resources.find((r) => r.id === 'ami-capece-old');
  assert.equal(newestAmi.isMostRecentInSeries, true);
  assert.equal(olderAmi.isMostRecentInSeries, false);
  assert.equal(olderAmi.latestImageIdInSeries, 'ami-capece-new');

  assert.equal(inventory.latestBackups.s3Series.selected[0].key, 'nightly/db-20260801-0700.dump');
  assert.equal(inventory.latestBackups.policy, 'most_recent');
});

test('resolveAccountLatestBackups never invents snapshot ids', async () => {
  const fixture = await loadFixture();
  const resolved = resolveAccountLatestBackups({
    snapshots: fixture.ec2.snapshots,
    images: fixture.ec2.images,
    volumes: fixture.ec2.volumes,
    s3Objects: collectS3ObjectsFromFixture(fixture),
  });
  const missing = resolved.volumes.find((row) => row.volumeId === 'vol-111');
  assert.equal(missing.snapshotId, null);
  assert.equal(missing.reason, 'no-completed-snapshot');
  const daily = resolved.volumes.find((row) => row.volumeId === 'vol-daily');
  assert.ok(fixture.ec2.snapshots.some((snap) => snap.SnapshotId === daily.snapshotId));
  assert.equal(
    resolved.amis.find((row) => row.prefix === 'capece-daily-').amiId,
    'ami-capece-new',
  );
});

test('VOLUME resource class stays on inventory after latest bind', async () => {
  const inventory = buildInventory(await loadFixture());
  assert.ok(inventory.resources.some((r) => r.resourceClass === RESOURCE_CLASS.VOLUME && r.id === 'vol-daily'));
});
