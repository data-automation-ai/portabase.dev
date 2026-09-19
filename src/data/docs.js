import { CLI_INSTALL } from '../lib/product.js';

export const restoreOrder = [
  { id: 'tables', title: 'Tables', body: 'Logical schema and row data first — roles, tables, constraints, and policies the rest of the project depends on.' },
  { id: 'views', title: 'Views', body: 'Views land after base tables exist so CREATE VIEW does not fail on missing relations.' },
  { id: 'procs', title: 'Procedures / RPCs', body: 'Stored procedures and PostgREST RPCs after the tables and views they call.' },
  { id: 'functions', title: 'Edge Functions', body: 'Function source and deploy metadata after the API surface they attach to.' },
  { id: 'data', title: 'Data + Storage + permissions', body: 'Remaining data fills, Storage object bytes (when present), and permission/RLS grants last so objects have buckets and policies.' },
];

export const fillMissing = {
  title: 'Fill-missing (absent-only)',
  summary: 'Fill writes only what is missing on the target. It is not incremental sync and not a live replica.',
  points: [
    'Storage: download / restore objects that are absent on the destination. Existing objects are left alone.',
    'Database: insert rows/tables that are missing. Already-present relations are not overwritten as a merge.',
    'Default writers: --writers 1 (serial, safer on small runners). Raise only if you have the disk and CPU.',
    'Not CDC. Not bidirectional. Not “keep two projects in sync.” Prove with replay into a blank project.',
    'Large fills need staging disk — use a cloud runner or a path you named. Do not surprise C: or F:.',
  ],
};

export const reportDrift = {
  title: '--report-drift',
  summary: 'Opt-in comparison after verify or replay. Reports drift; it does not silently “heal” a live project.',
  checks: [
    { id: 'md5', title: 'MD5 / checksum', body: 'Capsule checksums vs files that landed in your vault. Flags missing or mutated ciphertext.' },
    { id: 'rows', title: 'Row counts', body: 'Expected vs actual table counts from the inventory. Structural + count drift, not a full row dump to Cloud.' },
    { id: 'rbac', title: 'RBAC / grants', body: 'Roles, grants, and RLS presence vs the capsule inventory. Names and counts — not policy plaintext in telemetry.' },
  ],
};

export const exportManifest = {
  title: 'export-manifest / capsule-unload',
  summary: 'Local name-only inventory of what the capsule claims to hold. Not ingested by Portabase Cloud. No secrets, no passphrase, no object bytes.',
  commands: [
    { name: 'export-manifest', body: 'Writes a local JSON/Markdown listing of capsuleId, layers, table names, bucket names, function names, checksums. Keep it on your runner or a ticket you control — Cloud APIs reject object/table name inventory.' },
    { name: 'capsule-unload', body: 'Lists unloadable layer names and destination labels so a runner can stage a restore. Still ciphertext until you inject the passphrase locally.' },
  ],
  never: ['PORTABASE_ENCRYPTION_PASSPHRASE', 'SUPABASE_SERVICE_ROLE_KEY', 'DB URLs', 'Storage object contents', 'Row payloads'],
};

export const installCopy = {
  command: CLI_INSTALL.npmCommand,
  npmUrl: CLI_INSTALL.npmUrl,
  github: CLI_INSTALL.githubCli,
  steps: [
    `Install: ${CLI_INSTALL.npmCommand}`,
    'Or clone the CLI: github.com/DataAutomation-ai/portabase-CLI',
    'portabase init && portabase doctor',
    'Set PORTABASE_ENCRYPTION_PASSPHRASE on the runner (≥16 chars). Never paste it into this website.',
    'portabase backup · verify · replay --confirm-target <NEW_REF>',
  ],
};

export const telemetryUi = {
  title: 'Cloud telemetry (graphs)',
  summary: 'Provably zero-knowledge. The dashboard charts health signals: success/fail, duration, encrypted-byte totals, workers, plan cap, rescue readiness, drift counts. Cloud cannot see object names or keys.',
  never: [
    'Storage object names or paths',
    'Table row contents',
    'Capsule plaintext inventory',
    'Anything that implies Portabase can open the archive',
  ],
};

export const openCapsule = {
  title: 'Open a capsule (your side only)',
  summary: 'Provably zero-knowledge: Portabase cannot open this for you. Decrypt with your passphrase in the browser tab (metadata / fingerprint only) or on the CLI. The secret is never posted to Cloud APIs. No server-side decrypt path.',
  paths: [
    { name: 'Local file', body: 'Pick capsule.json for allowlisted metadata (layer flags, status). A .pbase stays sealed — this browser cannot run CLI scrypt or stream-decrypt multi-GB archives.' },
    { name: 'CLI', body: 'portabase verify --capsule <dir> --decrypt on the machine that holds the key. Same engine that sealed the archive.' },
  ],
};

export const liveSupabaseViewer = {
  title: 'Live Supabase viewer (browser only)',
  summary: 'See inside your live Supabase project from this tab. Keys and query results never go to Portabase Cloud. This is not a capsule browser — capsules stay provably zero-knowledge.',
  points: [
    'Paste project URL + anon or service_role key. Calls go browser → your PostgREST / Storage / Auth.',
    'Optional in-browser sign-in or OAuth against YOUR project (add this page as a redirect URL).',
    'sessionStorage is opt-in and documented; default is memory-only. Wipe clears the tab.',
    'Management API (api.supabase.com) is not proxied. If CORS blocks a call, use the CLI — we fail closed.',
  ],
};

export const destinationsGuide = [
  { id: 'local', title: 'Local Starter', body: 'Folder on this PC / USB / NAS. Capsules ≤ 100 MB unless you explicitly allow larger. Same-disk is not off-machine Escape.' },
  { id: 's3', title: 'Amazon S3', body: 'Your bucket. IAM / keys stay on the runner. Recommended production vault.' },
  { id: 'dropbox', title: 'Dropbox', body: 'OAuth or long-lived token / rclone on the runner — not stored as Cloud’s vault.' },
  { id: 'gdrive', title: 'Google Drive', body: 'rclone / Drive credentials on the runner. Cloud only stores the destination label.' },
  { id: 'rclone', title: 'rclone', body: 'Any rclone remote you already operate. Portabase does not proxy those credentials.' },
];
