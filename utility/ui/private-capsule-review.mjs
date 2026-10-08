import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { readPrivateCapsule, capsuleReviewBinding } from '../capsule-review-reader.mjs';
import { validatePrivateDirectory, loadPrivateEngineConfig } from '../../cloud/runner/private-config.mjs';
import { validatePrivateRestorePlan } from '../../cloud/runner/private-restore-plan.mjs';
import { RUNNER_ID_RE } from '../../cloud/runner/config-reference.mjs';
import { validateRestorePlan } from '../portabase-core.mjs';
import { sharedManifestSummary } from '../shared-manifest-export.mjs';

const fail = code => { throw Object.assign(new Error(code), { code }); };
export const REVIEW_BODY_BYTES = 256 * 1024;
function selected(value, known) {
  if (!Array.isArray(value) || value.length > known.length || new Set(value).size !== value.length || value.some(key => typeof key !== 'string' || !known.includes(key))) fail('invalid_restore_selection');
  return new Set(value);
}
export async function createPrivateCapsuleReview(options) {
  if (!RUNNER_ID_RE.test(options.runnerId || '') || !/^[a-z0-9]{20}$/.test(options.projectRef || '')
    || typeof options.capsulePath !== 'string' || !options.capsulePath
    || !Number.isSafeInteger(options.maxCipherBytes) || options.maxCipherBytes < 1
    || !Number.isSafeInteger(options.maxExpandedBytes) || options.maxExpandedBytes < 1024) fail('capsule_review_setup_required');
  await validatePrivateDirectory(options.directory);
  let current = null, approved = null, busy = false;
  const replayConfigured = typeof options.engineConfigPath === 'string' && Boolean(options.engineConfigPath)
    && typeof options.targetRef === 'string' && /^[a-z0-9]{20}$/.test(options.targetRef) && options.targetRef !== options.projectRef;
  return {
    bootstrap() { return { runnerId: options.runnerId, projectRef: options.projectRef, mode: 'offline-capsule-review',
      replayConfigured, ...(replayConfigured ? { targetRef: options.targetRef } : {}) }; },
    async inspect(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) fail('invalid_restore_selection');
      if (busy) fail('capsule_review_busy');
      busy = true; current = null; approved = null;
      try {
        const review = await readPrivateCapsule(options);
        const revision = randomUUID(); current = { ...review, revision };
        const { binding, ...projection } = current;
        if (Buffer.byteLength(JSON.stringify(projection)) > REVIEW_BODY_BYTES) { current = null; fail('capsule_review_limit'); }
        return projection;
      } finally { busy = false; }
    },
    async shareableSummary(body) {
      if (busy) fail('capsule_review_busy');
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1
        || !Object.hasOwn(body, 'revision') || typeof body.revision !== 'string') fail('invalid_shared_summary_request');
      if (!current || body.revision !== current.revision) fail('capsule_review_changed');
      const snapshot = current; busy = true;
      try {
        const bound = await capsuleReviewBinding(options);
        if (bound.digest !== snapshot.binding.metadataSha256 || bound.ciphertextSha256 !== snapshot.binding.ciphertextSha256) fail('capsule_review_changed');
        const objectCount = snapshot.buckets.reduce((sum, bucket) => sum + bucket.objectCount, 0);
        if (!Number.isSafeInteger(objectCount)) fail('capsule_review_limit');
        const known = name => snapshot.inventoryAvailable?.[name] === true
          && snapshot.components.some(component => component.name === name && component.complete && !component.skipped && !component.limited);
        // Counts come from the authenticated review, never the unauthenticated
        // outer manifest's optional contents. No inventory, logs or local paths
        // enter the sharing schema. This does not grant Cloud sharing consent.
        return sharedManifestSummary({ projectRef: snapshot.projectRef, createdAt: snapshot.createdAt, status: snapshot.status,
          contents: { storage: known('storage') ? { bucketCount: snapshot.buckets.length, objectCount } : {},
            functions: known('functions') ? { count: snapshot.functions.length } : {} },
        }, snapshot.binding.ciphertextSha256);
      } catch (error) { current = null; approved = null; throw error; }
      finally { busy = false; }
    },
    async save(body) {
      if (busy) fail('capsule_review_busy');
      approved = null;
      const keys = ['revision', 'selectedTables', 'selectedBuckets', 'selectedFunctions', 'maxBytes', 'confirmEmpty'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length || Object.keys(body).some(key => !keys.includes(key))
        || !Number.isSafeInteger(body.maxBytes) || body.maxBytes <= 0 || typeof body.confirmEmpty !== 'boolean') fail('invalid_restore_selection');
      if (!current || body.revision !== current.revision) fail('capsule_review_changed');
      const tables = selected(body.selectedTables, current.tables.map(row => `${row.schema}.${row.table}`));
      const buckets = selected(body.selectedBuckets, current.buckets.map(row => row.id));
      const functions = selected(body.selectedFunctions, current.functions.map(row => row.name));
      if (!tables.size && !buckets.size && !functions.size && !body.confirmEmpty) fail('empty_restore_selection');
      const snapshot = current; current = null; busy = true;
      try {
        const bound = await capsuleReviewBinding(options);
        if (bound.digest !== snapshot.binding.metadataSha256 || bound.ciphertextSha256 !== snapshot.binding.ciphertextSha256) fail('capsule_review_changed');
        const plan = { formatVersion: 1, capsuleId: snapshot.capsuleId, projectRef: snapshot.projectRef, maxBytes: body.maxBytes,
          createdAt: new Date().toISOString(), tables: snapshot.tables.map(row => ({ ...row, selected: tables.has(`${row.schema}.${row.table}`) })),
          buckets: snapshot.buckets.map(row => ({ ...row, selected: buckets.has(row.id) })), functions: snapshot.functions.map(row => ({ ...row, selected: functions.has(row.name) })) };
        try { validateRestorePlan(plan, { capsuleId: snapshot.capsuleId }); } catch { fail('restore_plan_over_budget'); }
        const bytes = `${JSON.stringify(plan, null, 2)}\n`;
        if (Buffer.byteLength(bytes) > REVIEW_BODY_BYTES) fail('capsule_review_limit');
        const base = join(bound.root, '.restore-plans');
        try { await mkdir(base, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
        await validatePrivateDirectory(base);
        const planRef = randomUUID(), dir = join(base, planRef);
        await mkdir(dir, { mode: 0o700 });
        await writeFile(join(dir, 'plan.json'), bytes, { flag: 'wx', mode: 0o600 });
        const descriptor = { version: 1, planRef, runnerId: options.runnerId, projectRef: snapshot.projectRef, capsuleId: snapshot.capsuleId,
          capsulePath: relative(bound.root, bound.capsule).replace(/\\/g, '/'), ...snapshot.binding,
          planSha256: createHash('sha256').update(bytes).digest('hex') };
        const bindingBytes = `${JSON.stringify(descriptor, null, 2)}\n`;
        await writeFile(join(dir, 'binding.json'), bindingBytes, { flag: 'wx', mode: 0o600 });
        approved = { planRef, bindingSha256: createHash('sha256').update(bindingBytes).digest('hex') };
        return { saved: true, ...approved,
          planPath: `.restore-plans/${planRef}/plan.json`, capsuleId: snapshot.capsuleId,
          selectedBytes: validateRestorePlan(plan).selectedBytes, execution: 'not_started' };
      } finally { busy = false; }
    },
    async createReplayReference(body) {
      if (busy) fail('capsule_review_busy');
      const keys = ['planRef', 'bindingSha256', 'targetRef', 'confirmTarget', 'confirmReplay'];
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== keys.length
        || Object.keys(body).some(key => !keys.includes(key)) || body.confirmReplay !== true) fail('invalid_replay_confirmation');
      if (!replayConfigured) fail('private_replay_setup_required');
      if (body.targetRef !== options.targetRef || body.confirmTarget !== options.targetRef
        || body.targetRef === options.projectRef) fail('replay_target_confirmation_required');
      if (!approved || body.planRef !== approved.planRef || body.bindingSha256 !== approved.bindingSha256) fail('capsule_review_changed');
      // One saved plan authorizes at most one immutable reference. A new inspect
      // invalidates it, and failures require inspecting/saving again.
      const snapshot = approved; approved = null; busy = true;
      try {
        const config = await loadPrivateEngineConfig(options);
        const validated = await validatePrivateRestorePlan({ ...options, planRef: snapshot.planRef,
          expectedBindingSha256: snapshot.bindingSha256 });
        const configRef = randomUUID(), reference = { version: 2, runnerId: options.runnerId, configRef, configRevision: 1 };
        const engineBytes = `${JSON.stringify(config.value, null, 2)}\n`;
        const record = { ...reference, operation: 'replay', projectRef: options.projectRef, targetRef: options.targetRef,
          engineConfigPath: `${configRef}/engine-1.json`, engineConfigSha256: createHash('sha256').update(engineBytes).digest('hex'),
          capsulePath: validated.binding.capsulePath, restorePlanRef: snapshot.planRef, restorePlanBindingSha256: snapshot.bindingSha256 };
        const recordBytes = `${JSON.stringify(record, null, 2)}\n`;
        if (Buffer.byteLength(engineBytes) > REVIEW_BODY_BYTES || Buffer.byteLength(recordBytes) > REVIEW_BODY_BYTES) fail('private_config_too_large');
        const revisionDirectory = join(config.root, configRef);
        await mkdir(revisionDirectory, { mode: 0o700 });
        await writeFile(join(revisionDirectory, 'engine-1.json'), engineBytes, { flag: 'wx', mode: 0o600 });
        await writeFile(join(revisionDirectory, '1.json'), recordBytes, { flag: 'wx', mode: 0o600 });
        // Only opaque identifiers leave this private action. It performs no
        // queue/provider request, admission decision, or restore execution.
        return { ...reference, type: 'replay' };
      } finally { busy = false; }
    },
  };
}
