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
