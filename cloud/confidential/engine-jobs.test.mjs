import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { engineJobs } from './engine-jobs.mjs';

test('a selected scope cannot bypass the populated-target guard',async()=>{
  const jobs=engineJobs({platform:'linux',run:async()=>assert.fail('must not run'),access:()=>({
    inspect:async()=>({blank:false,measuredBytes:1}),
    credentials:async()=>assert.fail('must not request credentials'),
  })});
  await assert.rejects(jobs.start({owner:'a'.repeat(64),sourceRef:'s'.repeat(20),targetRef:'t'.repeat(20),
    passphrase:'b'.repeat(43),maxBytes:1024,scope:{database:true,storage:false,auth:false,functions:false},
    scopeSummary:{tables:0,totalTables:10,buckets:0,totalBuckets:10,estimatedTableBytes:0,estimatedStorageBytes:0}}),
    /restore_target_not_blank/);
});

for(const selective of [false,true])test(`${selective?'selected-scope':'full'} no-vault capture and verified restore report times and delete temporary staging`, async () => {
  const sourceRef = 'abcdefghijklmnopqrst';
  const targetRef = 'bcdefghijklmnopqrstu';
  const owner = 'a'.repeat(64);
  const passphrase = 'b'.repeat(43);
  const seen = [];
  const access = () => ({
    inspect: async ref => ref === targetRef ? { blank: true, measuredBytes: 0 } : { measuredBytes: selective?30*1024**3:1024 },
    credentials: async ref => ({ ref, readOnly: false, managementToken: 'test-token', databaseUrl: 'test-db', serviceKey: 'test-key' }),
  });
  const run = async (args, env, root, _maxBytes, progress) => {
    seen.push({ args, root });
    if (args[0] === 'backup') {
      progress('database');
      await mkdir(join(root, 'capsules', 'test-capsule'), { recursive: true });
      await mkdir(join(root, 'status'), { recursive: true });
      await writeFile(join(root, 'capsules', 'test-capsule', 'payload'), 'encrypted-test-bytes');
      await writeFile(join(root, 'status', 'latest.json'), JSON.stringify({
        state: selective?'SELECTIVE':'COMPLETE', capsule: 'test-capsule', sizeBytes: 20, capsuleHash: 'test-hash',errors:[],
      }));
    } else {
      progress('database');
      assert.equal((await readFile(join(seen[0].root, 'capsules', 'test-capsule', 'payload'), 'utf8')), 'encrypted-test-bytes');
      await mkdir(join(root, 'evidence'), { recursive: true });
      await writeFile(join(root, 'evidence', 'restore.json'), JSON.stringify({ status: 'RECOVERY_DATA_PATH_VERIFIED' }));
    }
  };
  const jobs = engineJobs({ run, access, platform: 'linux' });
  const base = { owner, sourceRef, targetRef, sourceToken: 'source-test-token', targetToken: 'target-test-token',
    passphrase, maxBytes: 20 * 1024 ** 3, scope:{database:true,storage:true,auth:true,functions:true},
    ...(selective?{scopeSummary:{tables:1,totalTables:2,buckets:0,totalBuckets:1,estimatedTableBytes:1024,estimatedStorageBytes:0}}:{}) };
  const capture = await jobs.start({ ...base, operation: 'backup' });
  const captured = await jobs.wait(owner, capture.id);
  assert.equal(captured.state, 'complete');
  assert.equal(captured.result.destinationKind, 'temporary_runner');
  assert.equal(captured.result.captureScope,selective?'selected':'full');
  assert.ok(captured.phaseTimings.some(row => row.phase === 'database'));
  assert.ok(captured.durationMs >= 0);
  const restore = await jobs.start({ ...base, scopeSummary:undefined, operation: 'restore', capsuleId: capture.id });
  const restored = await jobs.wait(owner, restore.id);
  assert.equal(restored.state, 'complete');
  assert.equal(restored.result.restoreVerified, true);
  assert.equal(restored.result.databaseContentIdentityVerified, false);
  assert.equal(jobs.status(owner, capture.id).result.temporaryCapsuleRetained, false);
  await assert.rejects(stat(seen[0].root), { code: 'ENOENT' });
  await assert.rejects(stat(seen[1].root), { code: 'ENOENT' });
});

test('allowOverwrite allows occupied target and appends --allow-occupied-target to replay args', async () => {
  const sourceRef = 'abcdefghijklmnopqrst';
  const targetRef = 'bcdefghijklmnopqrstu';
  const owner = 'a'.repeat(64);
  const passphrase = 'b'.repeat(43);
  const seen = [];
  const access = () => ({
    inspect: async () => ({ blank: false, measuredBytes: 1024 }),
    credentials: async ref => ({ ref, readOnly: false, managementToken: 'test-token', databaseUrl: 'test-db', serviceKey: 'test-key' }),
  });
  const run = async (args, env, root, _maxBytes, progress) => {
    seen.push({ args, root });
    if (args[0] === 'backup') {
      progress('database');
      await mkdir(join(root, 'capsules', 'test-capsule'), { recursive: true });
      await mkdir(join(root, 'status'), { recursive: true });
      await writeFile(join(root, 'capsules', 'test-capsule', 'payload'), 'encrypted-test-bytes');
      await writeFile(join(root, 'status', 'latest.json'), JSON.stringify({
        state: 'COMPLETE', capsule: 'test-capsule', sizeBytes: 20, capsuleHash: 'test-hash', errors: [],
      }));
    } else {
      progress('database');
      await mkdir(join(root, 'evidence'), { recursive: true });
      await writeFile(join(root, 'evidence', 'restore.json'), JSON.stringify({ status: 'SELECTIVE_RESTORE_VERIFIED' }));
    }
  };
  const jobs = engineJobs({ run, access, platform: 'linux' });
  const base = { owner, sourceRef, targetRef, sourceToken: 'source-test-token', targetToken: 'target-test-token',
    passphrase, maxBytes: 20 * 1024 ** 3, scope: { database: true, storage: true, auth: true, functions: true },
    allowOverwrite: true };
  const capture = await jobs.start({ ...base, operation: 'backup' });
  const captured = await jobs.wait(owner, capture.id);
  assert.equal(captured.state, 'complete');
  const restore = await jobs.start({ ...base, operation: 'restore', capsuleId: capture.id });
  const restored = await jobs.wait(owner, restore.id);
  assert.equal(restored.state, 'complete');
  assert.equal(restored.result.restoreVerified, true);
  const restoreCall = seen.find(s => s.args[0] === 'replay');
  assert.ok(restoreCall.args.includes('--allow-occupied-target'));
});

test('engine wrapper aborts trusted usage reservations when credentials or child process fails',async()=>{
  for(const failure of ['credentials','child']){
    let aborted=0,authorized=0;
    const jobs=engineJobs({platform:'linux',meter:config=>({abort:async()=>{assert.equal(config.requestId,'synthetic-request');aborted++;}}),
      access:()=>({inspect:async()=>({blank:true,measuredBytes:1}),credentials:async()=>{if(failure==='credentials')throw Error('credentials_failed');return {ref:'s'.repeat(20),managementToken:'synthetic'};}}),
      run:async()=>{throw Error('child_failed');}});
    const owner='a'.repeat(64),job=await jobs.start({owner,sourceRef:'s'.repeat(20),passphrase:'b'.repeat(43),maxBytes:1024,
      scope:{database:true,storage:false,auth:false,functions:false},usageConfig:{requestId:'synthetic-request'},authorize:async()=>{authorized++;}});
    assert.equal((await jobs.wait(owner,job.id)).state,'failed');assert.equal(authorized,1);assert.equal(aborted,1);
  }
});
