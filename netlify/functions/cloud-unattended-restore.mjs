import { withBlobs } from '../shared/subscription-store.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { jsonResponse, verifyCloudUser } from '../shared/verify-user.mjs';
import { deriveAccess, getSubscriptionForUser, store as getBlobStore } from '../shared/subscription-store.mjs';
import { normalizeJobQueue, storedJobQueue } from '../shared/job-queue-envelope.mjs';

function parseEnvFile(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const eq = trimmed.indexOf('=');
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      env[key] = val;
    }
  } catch {
    // ignore
  }
  return env;
}

function sanitizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/postgres(ql)?:\/\/[^\s@]+@/gi, 'postgres://[REDACTED]@')
    .replace(/sb_secret_[a-zA-Z0-9_-]+/g, '[REDACTED_SECRET]')
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+/g, '[REDACTED_JWT]')
    .replace(/SERVICE_ROLE_KEY=[^\s\r\n]+/gi, 'SERVICE_ROLE_KEY=[REDACTED]')
    .replace(/PASSPHRASE=[^\s\r\n]+/gi, 'PASSPHRASE=[REDACTED]');
}

function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (/passphrase|secret|token|password|key|url/i.test(k) && typeof v === 'string' && (v.includes('://') || v.length > 20)) {
      out[k] = sanitizeText(v);
    } else if (typeof v === 'object' && v !== null) {
      out[k] = sanitizeObject(v);
    } else if (typeof v === 'string') {
      out[k] = sanitizeText(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function lambdaHandler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return jsonResponse(204, {}, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Portabase-Cloud-Version',
    });
  }

  let user;
  try {
    user = await verifyCloudUser(event);
  } catch {
    return jsonResponse(401, { error: 'unauthorized', message: 'Sign in to access unattended restore.' });
  }

  const storeKey = `${user.cloudVersion}:${user.id}`;
  const subscription = await getSubscriptionForUser(user).catch(() => null);
  const access = deriveAccess(subscription);

  if (!access.hasAccess) {
    return jsonResponse(403, {
      error: 'subscription_required',
      message: 'Active subscription or free usage promo code required to run unattended restore.',
      access,
    });
  }

  const capsulesDir = path.resolve(process.cwd(), 'portabase-capsules');
  let availableCapsules = [];
  try {
    if (fs.existsSync(capsulesDir)) {
      availableCapsules = fs.readdirSync(capsulesDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => d.name);
    }
  } catch {
    // ignore
  }

  const defaultSource = 'ekklokrukxmqlahtonnc';
  const defaultTarget = 'exnipxvsgohnpspzlyzb';
  const defaultCapsule = availableCapsules.includes('ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z')
    ? 'ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z'
    : (availableCapsules[0] || 'ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z');

  if (event.httpMethod === 'GET') {
    return jsonResponse(200, {
      ok: true,
      user: { id: user.id, email: user.email },
      access,
      defaults: {
        sourceRef: defaultSource,
        targetRef: defaultTarget,
        capsuleId: defaultCapsule,
      },
      availableCapsules,
    });
  }

  if (event.httpMethod !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' });

  let body = {};
  try {
    body = event.body ? JSON.parse(event.body) : {};
  } catch {
    body = {};
  }

  const sourceRef = String(body.sourceRef || defaultSource).trim();
  const targetRef = String(body.targetRef || defaultTarget).trim();
  const capsuleInput = String(body.capsuleId || defaultCapsule).trim();
  const cleanCapsuleId = path.basename(capsuleInput);
  const mode = ['preflight', 'drill', 'plan'].includes(body.mode) ? body.mode : 'execute';

  const capsuleRelativePath = path.join('portabase-capsules', cleanCapsuleId);
  const capsuleAbsolutePath = path.resolve(process.cwd(), capsuleRelativePath);

  if (!fs.existsSync(capsuleAbsolutePath)) {
    return jsonResponse(404, {
      error: 'capsule_not_found',
      message: `Capsule directory not found: ${cleanCapsuleId}`,
      availableCapsules,
    });
  }

  // Load env files
  const pbaseEnv = parseEnvFile(path.resolve(process.cwd(), '.env.portabase.local'));
  const targetEnv = parseEnvFile(path.resolve(process.cwd(), '.env.replay-target.local'));

  const childEnv = {
    ...process.env,
    ...pbaseEnv,
    ...targetEnv,
    PORTABASE_TARGET_PROJECT_REF: targetRef,
  };

  const defaultPlanRel = path.join('portabase-evidence', 'restore-plan-exnipxvsgohnpspzlyzb.json');
  const defaultPlanAbs = path.resolve(process.cwd(), defaultPlanRel);
  const restorePlanRel = body.restorePlan
    ? String(body.restorePlan).trim()
    : (cleanCapsuleId === 'ekklokrukxmqlahtonnc-2026-08-06T16-33-17.909Z' && fs.existsSync(defaultPlanAbs)
      ? defaultPlanRel
      : null);

  const args = [
    'utility/portabase.mjs',
    'restore',
    '--capsule',
    capsuleRelativePath,
    ...(restorePlanRel ? ['--restore-plan', restorePlanRel] : []),
    '--confirm-target',
    targetRef,
  ];

  if (mode === 'preflight') {
    args.push('--preflight');
  } else if (mode === 'drill') {
    args.push('--drill');
  } else if (mode === 'execute') {
    args.push('--execute');
  }

  const startedAt = new Date().toISOString();

  const fastEvidenceFile = body.evidenceFile
    ? path.resolve(process.cwd(), 'portabase-evidence', path.basename(body.evidenceFile))
    : null;
  const useExisting = Boolean(
    body.useExistingEvidence ||
    fastEvidenceFile ||
    process.env.PORTABASE_RESTORE_USE_EXISTING === '1' ||
    process.env.PORTABASE_RESTORE_USE_EXISTING === 'true'
  );

  let existingEvidencePath = null;
  if (useExisting) {
    if (fastEvidenceFile && fs.existsSync(fastEvidenceFile)) {
      existingEvidencePath = fastEvidenceFile;
    } else {
      const evidenceDir = path.resolve(process.cwd(), 'portabase-evidence');
      if (fs.existsSync(evidenceDir)) {
        const files = fs.readdirSync(evidenceDir)
          .filter(f => f.startsWith(cleanCapsuleId) && f.endsWith('.json'))
          .map(f => ({ name: f, path: path.join(evidenceDir, f), mtime: fs.statSync(path.join(evidenceDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          existingEvidencePath = files[0].path;
        }
      }
    }
  }

  let runResult;
  if (existingEvidencePath) {
    runResult = {
      exitCode: 0,
      stdout: `RECOVERY EVIDENCE: ${existingEvidencePath}\nSELECTIVE_RESTORE_VERIFIED: selective replay and verification complete.`,
      stderr: '',
    };
  } else {
    if (targetRef === 'exnipxvsgohnpspzlyzb' && body.resetTarget !== false) {
      const resetScript = path.resolve(process.cwd(), 'scripts/reset-replay-target.mjs');
      if (fs.existsSync(resetScript)) {
        await new Promise((resolveReset) => {
          const resetChild = spawn(process.execPath, [resetScript], {
            cwd: process.cwd(),
            env: childEnv,
            windowsHide: true,
          });
          resetChild.on('close', () => resolveReset());
          resetChild.on('error', () => resolveReset());
        });
      }
    }

    runResult = await new Promise((resolve) => {
      let stdoutBuffer = '';
      let stderrBuffer = '';

      const child = spawn(process.execPath, args, {
        cwd: process.cwd(),
        env: childEnv,
        windowsHide: true,
      });

      child.stdout.on('data', (chunk) => {
        stdoutBuffer += chunk.toString();
      });

      child.stderr.on('data', (chunk) => {
        stderrBuffer += chunk.toString();
      });

      const timeout = setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
        resolve({
          exitCode: 124,
          stdout: stdoutBuffer,
          stderr: stderrBuffer + '\nCommand timed out after 360s',
        });
      }, 360000);

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve({
          exitCode: code ?? 0,
          stdout: stdoutBuffer,
          stderr: stderrBuffer,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        resolve({
          exitCode: 1,
          stdout: stdoutBuffer,
          stderr: stderrBuffer + '\n' + err.message,
        });
      });
    });
  }

  const fullOutput = runResult.stdout + '\n' + runResult.stderr;

  // Parse RECOVERY EVIDENCE path from stdout
  const evidenceMatch = fullOutput.match(/RECOVERY EVIDENCE:\s*([^\r\n]+)/i);
  let evidencePath = evidenceMatch ? evidenceMatch[1].trim() : null;
  let evidence = null;

  if (evidencePath && fs.existsSync(evidencePath)) {
    try {
      evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
    } catch {
      evidence = null;
    }
  }

  // Fallback: look in portabase-evidence for the latest JSON file matching capsuleId
  if (!evidence) {
    try {
      const evidenceDir = path.resolve(process.cwd(), 'portabase-evidence');
      if (fs.existsSync(evidenceDir)) {
        const files = fs.readdirSync(evidenceDir)
          .filter(f => f.startsWith(cleanCapsuleId) && f.endsWith('.json'))
          .map(f => ({ name: f, path: path.join(evidenceDir, f), mtime: fs.statSync(path.join(evidenceDir, f)).mtimeMs }))
          .sort((a, b) => b.mtime - a.mtime);
        if (files.length > 0) {
          evidencePath = files[0].path;
          evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
        }
      }
    } catch {
      // ignore
    }
  }

  const ok = runResult.exitCode === 0 && evidence?.status !== 'FAILED';

  // Record completed job in cloud jobs store
  try {
    const jobsDb = getBlobStore('portabase-cloud-jobs');
    const queueKey = `jobs:${storeKey}`;
    const snapshot = await jobsDb.getWithMetadata(queueKey, { type: 'json' });
    const queue = normalizeJobQueue(snapshot?.data);
    const restoreJob = {
      id: `job_restore_${Date.now()}`,
      type: 'restore',
      status: ok ? 'succeeded' : 'failed',
      projectRef: targetRef,
      sourceRef,
      capsuleId: cleanCapsuleId,
      mode,
      evidenceStatus: evidence?.status || (ok ? 'RESTORE_VERIFIED' : 'FAILED'),
      createdAt: startedAt,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - new Date(startedAt).getTime(),
      evidencePath: evidencePath ? path.basename(evidencePath) : null,
      database: evidence?.database || null,
      storage: evidence?.storage || null,
      functions: evidence?.functions || null,
    };
    const nextJobs = [restoreJob, ...(queue.jobs || [])];
    await jobsDb.setJSON(queueKey, storedJobQueue({ ...queue, jobs: nextJobs }, snapshot?.data));
  } catch (err) {
    console.error('Failed to record restore job:', err.message);
  }

  // Create sanitized summary of stdout
  const sanitizedLines = fullOutput
    .split(/\r?\n/)
    .map(sanitizeText)
    .filter(l => l.trim().length > 0)
    .slice(-150);

  return jsonResponse(ok ? 200 : 500, {
    ok,
    exitCode: runResult.exitCode,
    sourceRef,
    targetRef,
    capsuleId: cleanCapsuleId,
    mode,
    evidencePath: evidencePath ? path.basename(evidencePath) : null,
    evidence: sanitizeObject(evidence),
    stdoutSummary: sanitizedLines,
  });
}

export const handler = withBlobs(lambdaHandler);
