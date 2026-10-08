import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

const namePattern = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const fail = code => { throw new Error(`function_replay_${code}`); };
export const isReplayFunctionName = value => typeof value === 'string' && namePattern.test(value);
async function info(path) {
  try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function directory(path) {
  const value = await info(path);
  if (!value?.isDirectory() || value.isSymbolicLink()) fail('invalid_source');
}
async function copyTree(source, destination) {
  const value = await info(source);
  if (!value || value.isSymbolicLink() || (!value.isFile() && !value.isDirectory()) || (value.isFile() && value.nlink !== 1)) fail('invalid_source');
  if (value.isFile()) {
    await copyFile(source, destination, 1); // COPYFILE_EXCL; staging never overwrites source.
    return;
  }
  await mkdir(destination, { mode: 0o700 });
  const seen = new Set();
  for (const item of await readdir(source)) {
    const key = item.normalize('NFC').toLowerCase();
    if (seen.has(key) || /[\\/:\x00-\x1f]/.test(item) || /[. ]$/.test(item)
      || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(item) || /^\.env(?:\.|$)/i.test(item)) fail('invalid_source');
    seen.add(key);
    await copyTree(join(source, item), join(destination, item));
  }
}

// Capture normally contains only downloaded source. If a CLI config is present,
// retain only supported per-function paths; never reuse its project or services.
async function capturedSettings(configPath, names) {
  const result = new Map();
  const value = await info(configPath);
  if (!value) return result;
  if (!value.isFile() || value.isSymbolicLink() || value.nlink !== 1 || value.size > 1024 * 1024) fail('unsupported_config');
  let current = null;
  for (const raw of (await readFile(configPath, 'utf8')).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('[')) {
      current = null;
      const match = /^\[functions\.([A-Za-z][A-Za-z0-9_-]{0,99})\]\s*(?:#.*)?$/.exec(line);
      if (match) {
        if (names.includes(match[1])) {
          if (result.has(match[1])) fail('unsupported_config');
          current = {}; result.set(match[1], current);
        }
      } else if (/^\[\[?\s*functions(?:\.|\s|\])/.test(line)) fail('unsupported_config');
      continue;
    }
    if (!current) continue;
    const match = /^(verify_jwt|enabled|entrypoint|import_map)\s*=\s*(true|false|"[^"\\\x00-\x1f]*"|'[^'\x00-\x1f]*')\s*(?:#.*)?$/.exec(line);
    if (!match || Object.hasOwn(current, match[1])) fail('unsupported_config');
    current[match[1]] = match[2] === 'true' ? true : match[2] === 'false' ? false : match[2].slice(1, -1);
  }
  return result;
}

function configPath(value, name, kind) {
  if (typeof value !== 'string') fail('unsupported_config');
  const normalized = value.replace(/^\.\//, '');
  const parts = normalized.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[\\:\x00-\x1f]/.test(part))) fail('unsupported_config');
  if (parts[0] !== 'functions' || (parts[1] !== name && !(kind === 'import_map' && parts.length === 2 && parts[1] === 'import_map.json'))) fail('unsupported_config');
  return `./${normalized}`;
}

/** Fresh project directory beneath the caller's private extracted tree.
 * Supports both CLI downloads and the management API fallback capture layout.
 * Caller owns the ACL of extracted; mode bits alone are not Windows isolation.
 */
export async function prepareFunctionReplayWorkspace(extracted, names, verifyMap) {
  if (!Array.isArray(names) || names.some(name => !isReplayFunctionName(name))
    || new Set(names.map(name => name.toLowerCase())).size !== names.length
    || !verifyMap || names.some(name => typeof verifyMap[name] !== 'boolean')) fail('invalid_selection');
  const root = resolve(extracted);
  if (/^f:/i.test(root)) fail('forbidden_directory');
  await directory(root);
  const capture = join(root, 'functions'); await directory(capture);
  const cliProject = join(capture, 'supabase');
  const cliRoot = join(cliProject, 'functions');
  // Check every ancestor before reading potential CLI sources.
  if (await info(cliProject)) await directory(cliProject);
  if (await info(cliRoot)) await directory(cliRoot);
  const settings = await capturedSettings(join(cliProject, 'config.toml'), names);
  const workdir = await mkdtemp(join(root, '.function-replay-'));
  const cleanup = async () => {
    if (!workdir.startsWith(`${root}${sep}.function-replay-`)) fail('invalid_directory');
    await rm(workdir, { recursive: true, force: true });
  };
  try {
    const staged = join(workdir, 'supabase', 'functions');
    await mkdir(staged, { recursive: true, mode: 0o700 });
    const roots = new Set(); const configurations = [];
    for (const name of names) {
      if (!isReplayFunctionName(name)) fail('invalid_name');
      const candidates = [join(capture, name), join(cliRoot, name)];
      const present = [];
      for (const path of candidates) if (await info(path)) present.push(path);
      if (present.length !== 1) fail(present.length ? 'ambiguous_source' : 'missing_source');
      const source = present[0]; await directory(source);
      const cliLayout = source === candidates[1]; roots.add(cliLayout ? cliRoot : capture);
      await copyTree(source, join(staged, name));
      const config = cliLayout ? settings.get(name) || {} : {};
      if (config.enabled === false || (Object.hasOwn(config, 'verify_jwt') && config.verify_jwt !== verifyMap[name])) fail('config_mismatch');
      let entrypoint = config.entrypoint;
      if (entrypoint === undefined) {
        const available = [];
        for (const extension of ['ts', 'js', 'tsx', 'jsx', 'mjs']) if (await info(join(staged, name, `index.${extension}`))) available.push(`./functions/${name}/index.${extension}`);
        if (available.length !== 1) fail('missing_or_ambiguous_entrypoint');
        [entrypoint] = available;
      }
      entrypoint = configPath(entrypoint, name, 'entrypoint');
      const entryInfo = await info(join(workdir, 'supabase', entrypoint));
      if (!entryInfo?.isFile() || entryInfo.size === 0) fail('missing_entrypoint');
      let importMap = config.import_map;
      if (importMap === undefined && await info(join(staged, name, 'import_map.json'))) importMap = `./functions/${name}/import_map.json`;
      if (importMap !== undefined) importMap = configPath(importMap, name, 'import_map');
      configurations.push({ name, entrypoint, importMap });
    }
    for (const shared of ['_shared', 'import_map.json', 'deno.json', 'deno.jsonc']) {
      const candidates = [];
      for (const sourceRoot of roots) if (await info(join(sourceRoot, shared))) candidates.push(join(sourceRoot, shared));
      if (candidates.length > 1) fail('ambiguous_shared_source');
      if (candidates.length) await copyTree(candidates[0], join(staged, shared));
    }
    const lines = ['project_id = "portabase-private-replay"'];
    for (const configuration of configurations) {
      const { name, entrypoint } = configuration;
      let { importMap } = configuration;
      if (!importMap && await info(join(staged, 'import_map.json'))) importMap = './functions/import_map.json';
      if (importMap && !(await info(join(workdir, 'supabase', importMap)))?.isFile()) fail('missing_import_map');
      lines.push('', `[functions.${name}]`, `verify_jwt = ${verifyMap[name]}`, `entrypoint = ${JSON.stringify(entrypoint)}`);
      if (importMap) lines.push(`import_map = ${JSON.stringify(importMap)}`);
    }
    await writeFile(join(workdir, 'supabase', 'config.toml'), `${lines.join('\n')}\n`, { flag: 'wx', mode: 0o600 });
    return { workdir, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export function verifyFunctionListing(stdout, names, verifyMap) {
  let rows; try { rows = JSON.parse(stdout); } catch { fail('invalid_listing'); }
  if (!Array.isArray(rows)) fail('invalid_listing');
  const byName = new Map();
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) fail('invalid_listing');
    const name = row.slug ?? row.name;
    if (!isReplayFunctionName(name) || (row.name !== undefined && row.name !== name)
      || typeof row.status !== 'string' || typeof row.verify_jwt !== 'boolean' || byName.has(name)) fail('invalid_listing');
    byName.set(name, row);
  }
  const active = names.filter(name => byName.get(name)?.status === 'ACTIVE');
  const missing = names.filter(name => !byName.has(name));
  const inactive = names.filter(name => byName.has(name) && byName.get(name).status !== 'ACTIVE');
  const jwtMismatch = names.filter(name => byName.has(name) && byName.get(name).verify_jwt !== verifyMap[name]);
  return { verified: !missing.length && !inactive.length && !jwtMismatch.length, expected: names, active, missing, inactive, jwtMismatch,
    verification: 'active-status-and-jwt-only' };
}
