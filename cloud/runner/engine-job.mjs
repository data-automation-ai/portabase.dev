/**
 * Cloud jobs call the same free open-source engine.
 * Feature freeze: only existing CLI commands/flags — no new capture features.
 */

export const FREE_ENGINE_ENTRY = 'utility/portabase.mjs';

export const FREE_ENGINE_COMMANDS = Object.freeze([
  'doctor',
  'backup',
  'verify',
  'restore',
  'replay',
  'status',
]);

/** Flags the free CLI already accepts. No new capture behavior. */
export const EXISTING_ENGINE_FLAGS = Object.freeze({
  excludeBinaries: '--exclude-binaries',
  excludeTableList: '--exclude-table-list',
  excludeTableData: '--exclude-table-data',
  excludeBuckets: '--exclude-buckets',
  trial: '--trial',
  decrypt: '--decrypt',
  confirmTarget: '--confirm-target',
});

export function buildFreeEngineArgv({
  command = 'doctor',
  excludeBinaries = false,
  excludeTableList = '',
  excludeTableData = '',
  excludeBuckets = '',
  trial = false,
  decrypt = false,
  confirmTarget = '',
  capsule = '',
} = {}) {
  const cmd = FREE_ENGINE_COMMANDS.includes(command) ? command : null;
  if (!cmd) {
    const err = new Error(`Unknown free-engine command: ${command}`);
    err.code = 'unknown_engine_command';
    throw err;
  }
  const argv = ['node', FREE_ENGINE_ENTRY, cmd];
  if (excludeBinaries && cmd === 'backup') argv.push(EXISTING_ENGINE_FLAGS.excludeBinaries);
  if (excludeTableList && (cmd === 'backup' || cmd === 'doctor')) {
    argv.push(EXISTING_ENGINE_FLAGS.excludeTableList, String(excludeTableList));
  }
  if (excludeTableData && (cmd === 'backup' || cmd === 'doctor')) {
    argv.push(EXISTING_ENGINE_FLAGS.excludeTableData, String(excludeTableData));
  }
  if (excludeBuckets && (cmd === 'backup' || cmd === 'doctor')) {
    argv.push(EXISTING_ENGINE_FLAGS.excludeBuckets, String(excludeBuckets));
  }
  if (trial && cmd === 'backup') argv.push(EXISTING_ENGINE_FLAGS.trial);
  if (decrypt && cmd === 'verify') argv.push(EXISTING_ENGINE_FLAGS.decrypt);
  if (confirmTarget && cmd === 'replay') {
    argv.push(EXISTING_ENGINE_FLAGS.confirmTarget, String(confirmTarget));
  }
  if (capsule && (cmd === 'verify' || cmd === 'restore' || cmd === 'replay')) {
    argv.push('--capsule', String(capsule));
  }
  return argv;
}

/** AWS capsule commands on the same runner. Not new Supabase capture flags. */
export const AWS_ENGINE_COMMANDS = Object.freeze(['inventory', 'doctor', 'plan']);

export function buildAwsEngineArgv({
  subcommand = 'plan',
  fixture = '',
  requireAws = true,
} = {}) {
  if (!AWS_ENGINE_COMMANDS.includes(subcommand)) {
    const err = new Error(`Unknown aws engine command: ${subcommand}`);
    err.code = 'unknown_aws_engine_command';
    throw err;
  }
  const argv = ['node', FREE_ENGINE_ENTRY, 'aws', subcommand];
  if (fixture) argv.push('--fixture', String(fixture));
  if (requireAws) argv.push('--require-aws');
  return argv;
}

export function describeEngineJob(spec = {}) {
  const argv = buildFreeEngineArgv(spec);
  return {
    engine: 'free-open-source-cli',
    entry: FREE_ENGINE_ENTRY,
    command: argv[2],
    argv,
    layers: ['pg_dump', 'edge-functions', 'storage', 'encrypted-capsule', 'restore'],
    note: 'Same path as the free CLI. Cloud adds the runner host only.',
  };
}
