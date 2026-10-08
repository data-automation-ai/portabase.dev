import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { writeRecoveryEvidence } from '../utility/portabase.mjs';

test('explicit private recovery evidence stays in the validated directory', async t => {
  const root = await mkdtemp(join(tmpdir(), 'pb-private-evidence-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = { capsuleId: 'synthetic-capsule', status: 'FAILED', error: 'synthetic private diagnostic' };
  const files = await writeRecoveryEvidence(report, { privateDirectory: root });
  assert.equal(dirname(files.jsonPath), root);
  assert.equal(dirname(files.htmlPath), root);
  assert.equal(JSON.parse(await readFile(files.jsonPath)).error, report.error);
  await assert.rejects(writeRecoveryEvidence(report, { privateDirectory: 'F:/refused' }), { code: 'private_config_path_refused' });
  await assert.rejects(writeRecoveryEvidence({ ...report, capsuleId: '../escape' }, { privateDirectory: root }), /Invalid capsule identity/);
});
