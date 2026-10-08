import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { restoreFunctions } from '../utility/portabase.mjs';

const target = 'bbbbbbbbbbbbbbbbbbbb';
const manifest = (names, verifyJwt = {}) => ({ contents: { functions: { complete: true, names, verifyJwt } } });
const plan = names => ({ functions: names.map(name => ({ name, selected: true })) });
async function fixture(t, files = { 'functions/hello/index.ts': 'Deno.serve(() => new Response("private-source"));' }) {
  const root = await mkdtemp(join(tmpdir(), 'portabase-functions-test-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(`${resolve(tmpdir())}${sep}portabase-functions-test-`));
    await rm(root, { recursive: true, force: true });
  });
  for (const [path, content] of Object.entries(files)) {
    const parts = path.split('/'); parts.pop(); await mkdir(join(root, ...parts), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
function adapters(rows = [{ name: 'hello', slug: 'hello', status: 'ACTIVE', verify_jwt: true }], override = {}) {
  return { resolveExecutable: () => 'synthetic-supabase', env: { SUPABASE_ACCESS_TOKEN: 'synthetic-token' },
    runCommand: async () => {}, runSync: () => ({ status: 0, stdout: JSON.stringify(rows) }), ...override };
}
async function noStaging(root) { assert.equal((await readdir(root)).some(name => name.startsWith('.function-replay-')), false); }

test('fallback capture is staged into explicit CLI layout; selection and JWT settings survive; original source preserved', async t => {
  const root = await fixture(t, { 'functions/hello/index.ts': 'private-source', 'functions/hook/index.js': 'private-hook',
    'functions/excluded/index.ts': 'excluded-source', 'functions/_shared/cors.ts': 'shared-source', 'functions/import_map.json': '{"imports":{}}' });
  const calls = []; let workdir;
  const result = await restoreFunctions(root, manifest(['hello', 'hook', 'excluded'], { hello: true, hook: false }), target, plan(['hello', 'hook']), adapters([
    { slug: 'hello', status: 'ACTIVE', verify_jwt: true }, { slug: 'hook', status: 'ACTIVE', verify_jwt: false },
    { slug: 'unselected', status: 'ACTIVE', verify_jwt: true },
  ], {
    runCommand: async (exe, args, options) => {
      calls.push(args); workdir = args[args.indexOf('--workdir') + 1];
      assert.equal(exe, 'synthetic-supabase'); assert.equal(options.cwd, workdir); assert.equal(options.stdio, 'ignore');
      assert.ok(workdir.startsWith(`${root}${sep}.function-replay-`));
      assert.equal(args[args.indexOf('--project-ref') + 1], target);
      assert.equal(await readFile(join(workdir, 'supabase/functions/hello/index.ts'), 'utf8'), 'private-source');
      assert.equal(await readFile(join(workdir, 'supabase/functions/_shared/cors.ts'), 'utf8'), 'shared-source');
      assert.equal(existsSync(join(workdir, 'supabase/functions/excluded')), false);
      const config = await readFile(join(workdir, 'supabase/config.toml'), 'utf8');
      assert.match(config, /\[functions.hello\]\nverify_jwt = true/);
      assert.match(config, /\[functions.hook\]\nverify_jwt = false\nentrypoint = "\.\/functions\/hook\/index.js"/);
      assert.match(config, /import_map = "\.\/functions\/import_map.json"/);
    },
    runSync: (exe, args, options) => {
      assert.deepEqual(args, ['functions', 'list', '--project-ref', target, '--output', 'json', '--workdir', workdir]);
      assert.equal(options.cwd, workdir);
      return { status: 0, stdout: JSON.stringify([{ name: 'hello', status: 'ACTIVE', verify_jwt: true }, { name: 'hook', status: 'ACTIVE', verify_jwt: false }]) };
    },
  }));
  assert.equal(result.verified, true); assert.equal(result.verification, 'active-status-and-jwt-only');
  assert.equal(calls.length, 2); assert.equal(calls[0].includes('--no-verify-jwt'), false); assert.equal(calls[1].includes('--no-verify-jwt'), true);
  assert.equal(await readFile(join(root, 'functions/hello/index.ts'), 'utf8'), 'private-source');
  assert.doesNotMatch(JSON.stringify(result), /private-source|synthetic-token|excluded|unselected/); await noStaging(root);
});

test('CLI downloaded nested sources and supported custom entrypoint/import map are staged', async t => {
  const root = await fixture(t, { 'functions/supabase/functions/hello/main.ts': 'custom-main',
    'functions/supabase/functions/hello/import_map.json': '{"imports":{}}',
    'functions/supabase/config.toml': 'project_id = "source-project"\n[functions.hello]\nverify_jwt = true\nentrypoint = "./functions/hello/main.ts"\nimport_map = "./functions/hello/import_map.json"\n[functions.excluded]\nverify_jwt = false\n' });
  const result = await restoreFunctions(root, manifest(['hello']), target, null, adapters(undefined, {
    runCommand: async (exe, args, options) => {
      const config = await readFile(join(options.cwd, 'supabase/config.toml'), 'utf8');
      assert.doesNotMatch(config, /source-project|excluded/); assert.match(config, /main.ts/);
      assert.equal(await readFile(join(options.cwd, 'supabase/functions/hello/main.ts'), 'utf8'), 'custom-main');
    },
  }));
  assert.equal(result.verified, true); await noStaging(root);
});

test('missing, ambiguous, unsafe or unsupported selected source fails before the first deploy', async t => {
  const cases = [
    { 'functions/hello/index.ts': 'x' }, // second selection missing
    { 'functions/hello/index.ts': 'x', 'functions/other/index.ts': 'x', 'functions/supabase/functions/hello/index.ts': 'x' },
    { 'functions/hello/index.ts': 'x', 'functions/other/index.ts': 'x', 'functions/hello/.env': 'do-not-copy' },
    { 'functions/hello/index.ts': 'x', 'functions/supabase/functions/other/index.ts': 'x', 'functions/supabase/config.toml': '[functions.other]\nstatic_files = ["./assets/*"]' },
  ];
  for (const files of cases) {
    const root = await fixture(t, files); let calls = 0;
    await assert.rejects(restoreFunctions(root, manifest(['hello', 'other']), target, null, adapters(undefined, { runCommand: async () => { calls++; } })), /function_replay_/);
    assert.equal(calls, 0); await noStaging(root);
  }
});

test('inactive, missing and JWT mismatched functions never verify', async t => {
  const root = await fixture(t);
  for (const rows of [[], [{ name: 'hello', status: 'INACTIVE', verify_jwt: true }], [{ name: 'hello', status: 'ACTIVE', verify_jwt: false }]]) {
    const report = await restoreFunctions(root, manifest(['hello']), target, null, adapters(rows));
    assert.equal(report.verified, false); await noStaging(root);
  }
});

test('malformed listing, duplicates, coerced fields and provider errors fail safely and clean up', async t => {
  const root = await fixture(t);
  for (const rows of [{ functions: [] }, null, [null], [{ name: 'hello' }], [{ name: 'hello', status: 'ACTIVE', verify_jwt: 'true' }],
    [{ name: 'hello', slug: 'other', status: 'ACTIVE', verify_jwt: true }],
    [{ name: 'hello', status: 'ACTIVE', verify_jwt: true }, { name: 'hello', status: 'ACTIVE', verify_jwt: true }]]) {
    await assert.rejects(restoreFunctions(root, manifest(['hello']), target, null, adapters(rows)), /function_replay_invalid_listing/); await noStaging(root);
  }
  for (const override of [
    { runCommand: async () => { throw new Error('private-token-and-source'); } },
    { runSync: () => ({ status: 1, stderr: 'private-token-and-source' }) },
    { runSync: () => ({ status: 0, stdout: 'private-token-and-source' }) },
  ]) {
    await assert.rejects(restoreFunctions(root, manifest(['hello']), target, null, adapters(undefined, override)), error => !error.message.includes('private-token') && error.message.startsWith('function_replay_'));
    await noStaging(root);
  }
});

test('empty selection does not require captured functions or a provider; unknown selection and invalid JWT fail', async () => {
  const noProvider = { resolveExecutable: () => { throw new Error('must not resolve'); } };
  assert.equal((await restoreFunctions('not-read', {}, target, plan([]), noProvider)).skipped, true);
  await assert.rejects(restoreFunctions('not-read', manifest(['hello']), target, plan(['other']), noProvider), /invalid_selection/);
  await assert.rejects(restoreFunctions('not-read', manifest(['hello'], { hello: 'false' }), target, null, noProvider), /invalid_jwt/);
});

test('source junctions cannot escape the extracted workspace', async t => {
  const root = await fixture(t, { 'functions/hello/index.ts': 'x', 'outside/index.ts': 'private-outside' });
  await symlink(join(root, 'outside'), join(root, 'functions/hello/escape'), process.platform === 'win32' ? 'junction' : 'dir');
  let calls = 0;
  await assert.rejects(restoreFunctions(root, manifest(['hello']), target, null, adapters(undefined, { runCommand: async () => { calls++; } })), /invalid_source/);
  assert.equal(calls, 0); await noStaging(root);
});
