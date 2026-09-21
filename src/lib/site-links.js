/**
 * Canonical public URLs used on the marketing site and console.
 * CLI GitHub repo verified 2026-09-18: DataAutomation-ai/portabase-CLI.
 */
import { CLI_INSTALL } from './product.js';

export const SITE_LINKS = Object.freeze({
  home: '/',
  backend: '/backend',
  security: '/security',
  cloud: '/cloud',
  docs: '/docs',
  legal: '/legal',
  login: '/login',
  app: '/app',
  npm: CLI_INSTALL.npmUrl,
  npmCommand: CLI_INSTALL.npmCommand,
  githubCli: CLI_INSTALL.githubCli,
  githubOrg: CLI_INSTALL.githubOrg,
});

/** Cloud console routes — including /dashboard?demo=1 (query is ignored here). */
export function isCloudConsolePath(pathname = '') {
  const path = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/';
  return path === '/app'
    || path === '/console'
    || path === '/dashboard'
    || path.startsWith('/app/')
    || path.startsWith('/dashboard/')
    || path === '/tools/supabase-viewer';
}

export function isDemoConsoleSearch(search = '') {
  const raw = String(search || '');
  const q = raw.startsWith('?') ? raw.slice(1) : raw;
  return new URLSearchParams(q).get('demo') === '1';
}

export function isDocsPath(pathname = '') {
  const path = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/';
  return path === '/docs' || path.startsWith('/docs/');
}

export const DOCS_HASHES = Object.freeze({
  install: 'install',
  capsules: 'capsules',
  workers: 'workers',
  trust: 'trust-boundary',
  fill: 'fill-missing',
  restore: 'restore-order',
  manifest: 'export-manifest',
  drift: 'report-drift',
  destinations: 'destinations',
  auth: 'auth-trial',
});
