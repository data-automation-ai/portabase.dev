/**
 * Public docs IA. Copy is sourced from docs/CLOUD.md, docs/FREE-CLI.md,
 * docs/REPLAY.md, docs/KEY-PROTECTION.md, docs/ZERO-KNOWLEDGE.md, README.md.
 * Do not invent commands, flags, or proven-green claims here.
 */
import { CLI_INSTALL } from '../lib/product.js';

export const DOCS_NAV = Object.freeze([
  Object.freeze({
    label: 'Get started',
    items: Object.freeze([
      Object.freeze({ slug: 'introduction', href: '/docs/introduction', title: 'Introduction' }),
      Object.freeze({ slug: 'quickstart', href: '/docs/quickstart', title: 'Quickstart' }),
      Object.freeze({ slug: 'keepalive', href: '/docs/keepalive', title: 'Keepalive' }),
      Object.freeze({ slug: 'rls-check', href: '/docs/rls-check', title: 'RLS exposure check' }),
    ]),
  }),
  Object.freeze({
    label: 'Recovery',
    items: Object.freeze([
      Object.freeze({ slug: 'restore-targets', href: '/docs/restore-targets', title: 'Restore targets' }),
      Object.freeze({ slug: 'disaster-recovery', href: '/docs/disaster-recovery', title: 'Disaster recovery' }),
      Object.freeze({ slug: 'auth-cutover', href: '/docs/auth-cutover', title: 'Auth cutover' }),
    ]),
  }),
  Object.freeze({
    label: 'Cloud',
    items: Object.freeze([
      Object.freeze({ slug: 'cloud', href: '/docs/cloud', title: 'Cloud' }),
    ]),
  }),
  Object.freeze({
    label: 'Trust',
    items: Object.freeze([
      Object.freeze({ slug: 'threat-model', href: '/docs/threat-model', title: 'Threat model' }),
      Object.freeze({ slug: 'proven', href: '/docs/proven', title: 'Proven vs not' }),
    ]),
  }),
  Object.freeze({
    label: 'Reference',
    items: Object.freeze([
      Object.freeze({ slug: 'cli', href: '/docs/cli', title: 'CLI reference' }),
    ]),
  }),
]);

export const DOCS_TITLES = Object.freeze({
  introduction: 'Introduction',
  quickstart: 'Quickstart',
  keepalive: 'Keepalive',
  'restore-targets': 'Restore targets',
  'disaster-recovery': 'Disaster recovery',
  'auth-cutover': 'Auth cutover',
  'rls-check': 'RLS exposure check',
  cloud: 'Cloud',
  'threat-model': 'Threat model',
  proven: 'Proven vs not',
  cli: 'CLI reference',
});

const CLI_HASHES = new Set([
  'install', 'fill-missing', 'restore-order', 'export-manifest',
  'report-drift', 'telemetry', 'open-capsule', 'live-supabase', 'destinations',
]);

export function resolveDocsSlug(pathname = '', hash = '') {
  const path = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/';
  const h = String(hash || '').replace(/^#/, '');
  if (path === '/docs/quickstart') return 'quickstart';
  if (path === '/docs/keepalive') return 'keepalive';
  if (path === '/docs/restore-targets') return 'restore-targets';
  if (path === '/docs/disaster-recovery') return 'disaster-recovery';
  if (path === '/docs/auth-cutover') return 'auth-cutover';
  if (path === '/docs/rls-check') return 'rls-check';
  if (path === '/docs/cloud') return 'cloud';
  if (path === '/docs/threat-model' || path === '/docs/keys') return 'threat-model';
  if (path === '/docs/proven' || path === '/docs/proven-vs-not') return 'proven';
  if (path === '/docs/cli' || path === '/docs/reference') return 'cli';
  if (path === '/docs' && CLI_HASHES.has(h)) return 'cli';
  return 'introduction';
}

export const QUICKSTART_COMMANDS = Object.freeze({
  install: CLI_INSTALL.npmCommand,
  capture: [
    'portabase init',
    'portabase doctor',
    'portabase backup',
    'portabase verify --capsule ./portabase-capsules/CAPSULE_NAME',
    'portabase restore --capsule ./portabase-capsules/CAPSULE_NAME',
    'portabase restore --capsule ./portabase-capsules/CAPSULE_NAME --execute --confirm-target NEW_PROJECT_REF',
  ].join('\n'),
  trial: 'portabase backup --trial',
  replay: [
    'portabase replay --capsule ./portabase-capsules/CAPSULE_NAME --confirm-target NEW_PROJECT_REF --preflight',
    'portabase replay --capsule ./portabase-capsules/CAPSULE_NAME --confirm-target NEW_PROJECT_REF',
  ].join('\n'),
  repoLocal: [
    'npm run portabase -- init',
    'npm run portabase -- doctor',
    'npm run portabase -- backup',
    'npm run portabase -- verify --capsule ./portabase-capsules/CAPSULE_NAME',
    'npm run portabase -- restore --capsule ./portabase-capsules/CAPSULE_NAME',
  ].join('\n'),
  exclude: 'portabase backup --exclude-binaries',
});
