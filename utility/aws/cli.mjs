/**
 * CLI: portabase aws inventory | doctor | plan
 *
 * Read-only scaffold. Refuses live account calls and all mutate/snapshot flags.
 * `aws plan` is dry-run only: it scripts the operator/Combo command sequence.
 * Supabase commands (doctor, backup, replay, …) are unchanged.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildDoctorReport, formatDoctorText } from './doctor.mjs';
import { buildInventory } from './inventory.mjs';
import { createLiveClient } from './interfaces.mjs';
import {
  assertRunnerAwsAuth,
  detectRunnerAwsAuth,
  redactRunnerAwsAuth,
} from './runner-auth.mjs';
import {
  buildAwsRunPlan,
  formatAwsRunPlanMarkdown,
  formatAwsRunPlanText,
} from './run-plan.mjs';
import { validateAwsCapsuleManifest } from './schema.mjs';
import {
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_INVENTORY_SCHEMA_VERSION,
  versionBanner,
} from './versions.mjs';

const REFUSED_FLAGS = Object.freeze([
  'live',
  'snapshot',
  'create-snapshot',
  'mutate',
  'execute',
  'restore',
  'replay',
]);

export function awsHelpText() {
  return `Portabase AWS Capsule V2 (scaffold)

Customer-owned encrypted AWS escape package. Same never-hold-keys shape as Supabase
Portabase: Portabase never holds sealing keys or capsule bytes.

The client runner uses the standard AWS credential chain (instance role preferred,
then AWS_PROFILE / env keys, or keys sealed to this runner). Portabase Cloud never
stores AWS keys. Fail closed if this runner has no credentials.

--fixture is the offline/CI path. Without --fixture, credentials are required and
this scaffold still will not describe or mutate a live account (--live refused).

Versions:
  capsule format     ${AWS_CAPSULE_FORMAT_VERSION}
  inventory schema   ${AWS_INVENTORY_SCHEMA_VERSION}

Commands:
  aws inventory   Scripted/binary inventory (--fixture or runner AWS chain)
  aws doctor      will-copy / will-warn / will-fail report (never claims proven)
  aws plan        Dry-run runbook: inventory → doctor → latest-snapshot → export → seal

Optional:
  --fixture <path>   Offline JSON (CI). Without it, require runner AWS creds.
  --require-aws      Fail closed unless the runner credential chain is present
  --out <path>       Write JSON
  --md <path>        Write AWS_RUN_PLAN.md (plan only)
  --json             Print JSON instead of text (doctor / plan)

Refused (this scaffold):
  --live  --snapshot  --create-snapshot  --mutate  --execute

Binaries = most recent completed backups. Capsule scripts the runs.
Portabase never holds the bytes.

Docs: docs/AWS_CAPSULE.md · docs/AWS_RUNNER_AUTH.md · docs/AWS_RUN_PLAN.md
`;
}

export function parseAwsArgs(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[name] = next;
        i += 1;
      } else {
        flags[name] = true;
      }
    } else {
      positional.push(token);
    }
  }
  return { flags, positional };
}

export function assertAwsFlagsAllowed(flags) {
  const hit = REFUSED_FLAGS.filter((name) => flags[name]);
  if (hit.length) {
    throw new Error(
      `Refused --${hit.join(' --')}: AWS capsule V2 scaffold is read-only and will not mutate an account or create snapshots.`,
    );
  }
}

function resolveCliAuth(flags, env) {
  if (flags.live) createLiveClient();
  const checkSharedFiles = env === process.env;
  if (!flags.fixture) {
    const auth = assertRunnerAwsAuth(env, { checkSharedFiles });
    throw new Error(
      `Runner AWS credentials resolved (mode=${auth.mode}`
      + `${auth.profile ? `, profile=${auth.profile}` : ''}`
      + `${auth.preferred ? ', preferred instance-role' : ''}`
      + '). Live describe uses that chain on Combo; this scaffold will not call AWS APIs. '
      + 'Pass --fixture <json> for offline inventory/doctor/plan. --live mutate remains refused.',
    );
  }
  if (flags['require-aws']) {
    return assertRunnerAwsAuth(env, { checkSharedFiles });
  }
  return redactRunnerAwsAuth(detectRunnerAwsAuth(env, { fixture: true }));
}

async function loadFixture(flags) {
  const path = flags.fixture;
  if (!path) {
    throw new Error('portabase aws requires --fixture <json> in this scaffold, or runner AWS credentials (fail closed if missing).');
  }
  const full = resolve(path);
  const fixture = JSON.parse(await readFile(full, 'utf8'));
  return { fixture, path: full };
}

export async function runAwsInventory(args, io = console, env = process.env) {
  const { flags } = parseAwsArgs(args);
  assertAwsFlagsAllowed(flags);
  const runnerAuth = resolveCliAuth(flags, env);
  const { fixture } = await loadFixture(flags);
  const inventory = buildInventory(fixture);
  const report = {
    command: 'aws inventory',
    ...versionBanner(),
    ...inventory,
    latestBackups: inventory.latestBackups,
    runnerAuth,
    note: 'Scripted resources are capsule candidates. Binaries = most recent completed backups (IDs only). Not proven. Runner AWS creds never leave this machine.',
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (flags.out) {
    await writeFile(resolve(flags.out), json);
    io.log(`aws inventory wrote ${resolve(flags.out)} (${inventory.resources.length} resources)`);
  } else {
    io.log(json.trimEnd());
  }
  return report;
}

export async function runAwsDoctor(args, io = console, env = process.env) {
  const { flags } = parseAwsArgs(args);
  assertAwsFlagsAllowed(flags);
  const runnerAuth = resolveCliAuth(flags, env);
  const { fixture } = await loadFixture(flags);
  const inventory = buildInventory(fixture);
  const report = { ...buildDoctorReport(inventory), runnerAuth };
  validateAwsCapsuleManifest(report.manifest);
  if (flags.out) {
    await writeFile(resolve(flags.out), `${JSON.stringify(report, null, 2)}\n`);
    io.log(`aws doctor wrote ${resolve(flags.out)}`);
  }
  if (flags.json || flags.out) {
    if (flags.json) io.log(JSON.stringify(report, null, 2));
  } else {
    io.log(formatDoctorText(report));
  }
  return report;
}

export async function runAwsPlan(args, io = console, env = process.env) {
  const { flags } = parseAwsArgs(args);
  assertAwsFlagsAllowed(flags);
  const runnerAuth = resolveCliAuth(flags, env);
  const { fixture, path } = await loadFixture(flags);
  const inventory = buildInventory(fixture);
  const plan = buildAwsRunPlan(inventory, {
    fixturePath: flags.fixture || path,
    region: flags.region || inventory.regions?.[0],
    runnerAuth,
  });
  if (flags.out) {
    await writeFile(resolve(flags.out), `${JSON.stringify(plan, null, 2)}\n`);
    io.log(`aws plan wrote ${resolve(flags.out)}`);
  }
  if (flags.md) {
    await writeFile(resolve(flags.md), formatAwsRunPlanMarkdown(plan));
    io.log(`aws plan wrote markdown ${resolve(flags.md)}`);
  }
  if (flags.json || flags.out) {
    if (flags.json) io.log(JSON.stringify(plan, null, 2));
  } else {
    io.log(formatAwsRunPlanText(plan));
  }
  return { ...plan, command: 'aws plan', exitCode: 0 };
}

export async function runAwsCli(args, io = console, env = process.env) {
  const sub = args[0];
  const rest = args.slice(1);
  if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
    io.log(awsHelpText());
    return { command: 'aws help' };
  }
  if (['snapshot', 'create-snapshot', 'backup', 'restore', 'replay', 'capture'].includes(sub)) {
    throw new Error(
      `portabase aws ${sub} is not implemented. V2 scaffold is read-only (inventory + doctor + plan). It will not create snapshots or restore an account.`,
    );
  }
  if (sub === 'inventory') return runAwsInventory(rest, io, env);
  if (sub === 'doctor') return runAwsDoctor(rest, io, env);
  if (sub === 'plan') return runAwsPlan(rest, io, env);
  io.log(awsHelpText());
  throw new Error(`Unknown aws subcommand: ${sub}. Use inventory, doctor, or plan.`);
}
