/**
 * Runner AWS authentication — customer runner only.
 *
 * Same never-hold-keys rule as Supabase Cloud:
 *   AWS credentials stay on the customer runner (laptop, Combo, Cloud worker).
 *   The Portabase control plane never stores access keys, secret keys, session
 *   tokens, or secret-bundle values.
 *
 * Modes (most preferred first when several could apply):
 *   1. instance-role  — EC2 instance profile / ECS task role / IRSA (Combo default)
 *   2. env            — AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY on the runner
 *   3. profile        — AWS_PROFILE / shared credentials file on the runner
 *   4. sealed-to-runner — browser/CLI sealed envelope delivered to the runner
 *   5. fixture        — offline unit tests; no live account
 *
 * This module never returns secret values. Detection is fail-closed.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const RUNNER_AWS_AUTH_MODES = Object.freeze({
  INSTANCE_ROLE: 'instance-role',
  ENV: 'env',
  PROFILE: 'profile',
  SEALED_TO_RUNNER: 'sealed-to-runner',
  FIXTURE: 'fixture',
  NONE: 'none',
});

export const RUNNER_AWS_AUTH_ERROR = 'RUNNER_AWS_CREDS_MISSING';

export class RunnerAwsAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RunnerAwsAuthError';
    this.code = RUNNER_AWS_AUTH_ERROR;
  }
}

export function sharedCredentialsPath(env = {}) {
  return env.AWS_SHARED_CREDENTIALS_FILE || join(homedir(), '.aws', 'credentials');
}

export function sharedConfigPath(env = {}) {
  return env.AWS_CONFIG_FILE || join(homedir(), '.aws', 'config');
}

function hasEnvKeys(env = {}) {
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

function profileName(env = {}) {
  return env.AWS_PROFILE || env.AWS_DEFAULT_PROFILE || null;
}

function hasInstanceRoleIndicators(env = {}, options = {}) {
  if (env.AWS_EC2_METADATA_DISABLED === 'true') return false;
  if (options.instanceMetadataPresent === true) return true;
  if (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI) return true;
  if (env.AWS_CONTAINER_CREDENTIALS_FULL_URI) return true;
  if (env.AWS_WEB_IDENTITY_TOKEN_FILE) return true;
  if (env.AWS_ROLE_ARN && env.AWS_WEB_IDENTITY_TOKEN_FILE) return true;
  return false;
}

function hasSharedFiles(env = {}, options = {}) {
  if (options.checkSharedFiles === false) return false;
  try {
    return existsSync(sharedCredentialsPath(env)) || existsSync(sharedConfigPath(env));
  } catch {
    return false;
  }
}

/**
 * Detect how this runner would authenticate. Never includes secret material.
 *
 * @param {NodeJS.ProcessEnv|object} [env]
 * @param {{
 *   checkSharedFiles?: boolean,
 *   instanceMetadataPresent?: boolean,
 *   sealedToRunner?: boolean,
 *   fixture?: boolean,
 * }} [options]
 */
export function detectRunnerAwsAuth(env = {}, options = {}) {
  if (options.fixture) {
    return {
      mode: RUNNER_AWS_AUTH_MODES.FIXTURE,
      ok: true,
      preferred: false,
      profile: null,
      region: env.AWS_REGION || env.AWS_DEFAULT_REGION || null,
      hasAccessKeyId: false,
      hasSecretKey: false,
      sealedToRunner: false,
      instanceRole: false,
      note: 'Offline fixture. No live AWS calls.',
    };
  }

  const instanceRole = hasInstanceRoleIndicators(env, options);
  const envKeys = hasEnvKeys(env);
  const profile = profileName(env);
  const shared = Boolean(profile) || hasSharedFiles(env, options);
  const sealed = options.sealedToRunner === true;

  let mode = RUNNER_AWS_AUTH_MODES.NONE;
  if (instanceRole) mode = RUNNER_AWS_AUTH_MODES.INSTANCE_ROLE;
  else if (envKeys) mode = RUNNER_AWS_AUTH_MODES.ENV;
  else if (shared) mode = RUNNER_AWS_AUTH_MODES.PROFILE;
  else if (sealed) mode = RUNNER_AWS_AUTH_MODES.SEALED_TO_RUNNER;

  return {
    mode,
    ok: mode !== RUNNER_AWS_AUTH_MODES.NONE,
    preferred: mode === RUNNER_AWS_AUTH_MODES.INSTANCE_ROLE,
    profile: profile || (mode === RUNNER_AWS_AUTH_MODES.PROFILE ? 'default' : null),
    region: env.AWS_REGION || env.AWS_DEFAULT_REGION || null,
    hasAccessKeyId: Boolean(env.AWS_ACCESS_KEY_ID),
    hasSecretKey: Boolean(env.AWS_SECRET_ACCESS_KEY),
    sealedToRunner: sealed,
    instanceRole,
    chain: [
      instanceRole ? 'instance-role' : null,
      envKeys ? 'env' : null,
      shared ? 'profile' : null,
      sealed ? 'sealed-to-runner' : null,
    ].filter(Boolean),
    note: mode === RUNNER_AWS_AUTH_MODES.NONE
      ? 'No AWS credentials on this runner. Fail closed.'
      : 'Credentials stay on this runner. Portabase control plane never stores AWS keys.',
  };
}

export function assertRunnerAwsAuth(env = {}, options = {}) {
  const auth = detectRunnerAwsAuth(env, options);
  if (!auth.ok) {
    throw new RunnerAwsAuthError(
      [
        'No AWS credentials on this runner. Fail closed.',
        'The client runner must access the customer AWS account to inventory and script most-recent backups.',
        'Provide one of: instance role (preferred on Combo / customer worker),',
        'AWS_PROFILE / shared credentials on this machine, AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY,',
        'or a browser/CLI seal of AWS keys to this runner.',
        'Portabase Cloud never stores AWS keys. --live mutate remains refused.',
      ].join(' '),
    );
  }
  return redactRunnerAwsAuth(auth);
}

/** Telemetry / doctor-safe view — booleans and mode only. */
export function redactRunnerAwsAuth(auth) {
  if (!auth || typeof auth !== 'object') {
    return { mode: RUNNER_AWS_AUTH_MODES.NONE, ok: false };
  }
  return {
    mode: auth.mode,
    ok: Boolean(auth.ok),
    preferred: Boolean(auth.preferred),
    profile: auth.profile || null,
    region: auth.region || null,
    hasAccessKeyId: Boolean(auth.hasAccessKeyId),
    hasSecretKey: Boolean(auth.hasSecretKey),
    sealedToRunner: Boolean(auth.sealedToRunner),
    instanceRole: Boolean(auth.instanceRole),
    chain: Array.isArray(auth.chain) ? [...auth.chain] : [],
    note: auth.note || null,
  };
}

export const RUNNER_AWS_TELEMETRY_ALLOWLIST = Object.freeze([
  'status',
  'counts',
  'sizes',
  'hashes',
  'destinationKind',
  'safeError',
  'authMode',
  'resourceCount',
  'binaryFootprintGiB',
]);

export const RUNNER_AWS_TELEMETRY_FORBIDDEN = Object.freeze([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'awsSecretAccessKey',
  'sessionToken',
  'secrets-bundle',
  'SecretString',
  'capsuleBytes',
  'passphrase',
]);
