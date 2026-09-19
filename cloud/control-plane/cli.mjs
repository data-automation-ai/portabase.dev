#!/usr/bin/env node
/**
 * Control-plane replica operator commands.
 *
 *   node cloud/control-plane/cli.mjs open
 *   node cloud/control-plane/cli.mjs replicate
 *   node cloud/control-plane/cli.mjs sync
 *   node cloud/control-plane/cli.mjs backup --dest /var/lib/portabase-cloud/backups/
 *   node cloud/control-plane/cli.mjs schedule --dest /var/lib/portabase-cloud/backups/ --every 86400
 *
 * Requires PORTABASE_CLOUD_SQLITE_PATH (persistent .db, never :memory:).
 * replicate/sync also need PORTABASE_CLOUD_SUPABASE_URL + PORTABASE_CLOUD_SUPABASE_SERVICE_KEY
 * pointing at the Portabase Cloud project — not ekklokrukxmqlahtonnc.
 *
 * This process needs a durable disk (control-plane host). Do not run it on
 * Netlify Functions (ephemeral filesystem).
 */
import { statSync } from 'node:fs';
import { createControlPlaneStore } from './store.mjs';
import { createPrimaryFromEnv, createInjectedPrimary } from './supabase-primary.mjs';
import { resolveBackupFile } from './backup.mjs';

function usage(code = 1) {
  const text = `Usage:
  node cloud/control-plane/cli.mjs open
  node cloud/control-plane/cli.mjs replicate
  node cloud/control-plane/cli.mjs sync
  node cloud/control-plane/cli.mjs backup --dest PATH
  node cloud/control-plane/cli.mjs schedule --dest DIR --every SECONDS

Env:
  PORTABASE_CLOUD_SQLITE_PATH     required persistent .db path
  PORTABASE_CLOUD_SUPABASE_URL    Portabase Cloud project (not ekklokrukxmqlahtonnc)
  PORTABASE_CLOUD_SUPABASE_SERVICE_KEY
`;
  if (code === 0) console.log(text);
  else console.error(text);
  process.exit(code);
}

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dest' || token === '--every' || token === '--path') {
      flags[token.slice(2)] = argv[i + 1];
      i += 1;
    } else if (token === '-h' || token === '--help') {
      flags.help = true;
    } else {
      rest.push(token);
    }
  }
  return { flags, rest };
}

function sqlitePath(flags) {
  return flags.path || process.env.PORTABASE_CLOUD_SQLITE_PATH;
}

function openStore(flags, { requirePrimary }) {
  const filePath = sqlitePath(flags);
  let primary;
  if (requirePrimary) {
    primary = createPrimaryFromEnv();
  } else if (process.env.PORTABASE_CLOUD_SUPABASE_URL) {
    primary = createPrimaryFromEnv();
  } else {
    // open/backup can run without a live primary; injected double stays down.
    primary = createInjectedPrimary();
    primary.setDown(true);
  }
  return createControlPlaneStore({ filePath, primary });
}

const { flags, rest } = parseArgs(process.argv.slice(2));
const command = rest[0];
if (flags.help || !command) usage(flags.help ? 0 : 1);

if (command === 'open') {
  const store = openStore(flags, { requirePrimary: false });
  const health = await store.health();
  const collections = {};
  for (const name of ['subscribers', 'promo_codes', 'billing_metadata', 'jobs', 'capsule_hashes']) {
    collections[name] = (await store.list(name)).length;
  }
  console.log(JSON.stringify({ ok: true, ...health, collections }, null, 2));
  store.close();
  process.exit(0);
}

if (command === 'replicate') {
  const store = openStore(flags, { requirePrimary: true });
  try {
    const result = await store.replicate();
    console.log(JSON.stringify({ ok: true, ...result, health: await store.health() }, null, 2));
  } finally {
    store.close();
  }
  process.exit(0);
}

if (command === 'sync') {
  const store = openStore(flags, { requirePrimary: true });
  try {
    const result = await store.syncBack();
    console.log(JSON.stringify({ ok: true, ...result, health: await store.health() }, null, 2));
  } finally {
    store.close();
  }
  process.exit(0);
}

if (command === 'backup') {
  if (!flags.dest) usage(1);
  const store = openStore(flags, { requirePrimary: false });
  try {
    let dest = flags.dest;
    try {
      if (statSync(dest).isDirectory()) {
        dest = resolveBackupFile(dest, { destIsDirectory: true });
      }
    } catch {
      // dest does not exist yet — treat as a file path
    }
    const result = store.backup(dest);
    console.log(JSON.stringify({ ok: true, backup: result }, null, 2));
  } finally {
    store.close();
  }
  process.exit(0);
}

if (command === 'schedule') {
  if (!flags.dest) usage(1);
  const everySec = Number(flags.every || 86400);
  const store = openStore(flags, { requirePrimary: false });
  const scheduled = store.scheduleBackup({
    destDir: flags.dest,
    intervalMs: everySec * 1000,
  });
  console.log(JSON.stringify({
    ok: true,
    scheduled: true,
    intervalSeconds: everySec,
    destDir: scheduled.destDir,
    first: scheduled.first,
  }, null, 2));
  const stop = () => {
    scheduled.stop();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
} else {
  usage(1);
}
