/**
 * AWS capsule manifest schema + validator.
 * Documents are JSON; this module is the runtime source of truth.
 */

import { findForbiddenSecrets } from './redaction.mjs';
import {
  AWS_CAPSULE_FORMAT_VERSION,
  AWS_CAPSULE_KIND,
  AWS_COVERAGE_CLAIMS,
  AWS_DEFAULT_PROFILE,
  AWS_INVENTORY_SCHEMA_VERSION,
} from './versions.mjs';

export const AWS_CAPSULE_MANIFEST_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://portabase.dev/schema/aws-capsule-manifest-1.0.0.json',
  title: 'Portabase AWS Capsule Manifest',
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'capsuleFormatVersion',
    'inventorySchemaVersion',
    'profile',
    'createdAt',
    'account',
    'regions',
    'scripted',
    'binaryReferences',
    'measurement',
    'coverage',
    'secretsPolicy',
  ],
  properties: {
    kind: { const: AWS_CAPSULE_KIND },
    capsuleFormatVersion: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    inventorySchemaVersion: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    profile: { type: 'string', enum: ['exclude-binaries'] },
    createdAt: { type: 'string' },
    account: {
      type: 'object',
      required: ['accountId'],
      additionalProperties: false,
      properties: {
        accountId: { type: 'string', pattern: '^[0-9]{12}$' },
        aliases: { type: 'array', items: { type: 'string' } },
        partition: { type: 'string', enum: ['aws', 'aws-us-gov', 'aws-cn'] },
      },
    },
    regions: { type: 'array', items: { type: 'string', minLength: 2 }, minItems: 1 },
    scripted: { type: 'object' },
    binaryReferences: { type: 'object' },
    measurement: {
      type: 'object',
      required: ['scriptedEstimateBytes', 'binaryFootprintGiB'],
      properties: {
        scriptedEstimateBytes: { type: 'number', minimum: 0 },
        binaryFootprintGiB: { type: 'number', minimum: 0 },
        resourceCount: { type: 'number', minimum: 0 },
        costSignals: { type: 'object' },
      },
    },
    coverage: {
      type: 'object',
      required: ['proven', 'restoreDrill', 'match', 'binariesInCapsule'],
      properties: {
        proven: { const: false },
        restoreDrill: { type: 'string' },
        match: { const: false },
        binariesInCapsule: { type: 'boolean' },
        scriptedComplete: { type: 'boolean' },
        note: { type: 'string' },
      },
    },
    secretsPolicy: {
      type: 'object',
      required: [
        'credentialsPacked',
        'secretValuesPacked',
        'secureStringValuesPacked',
        'privateKeysPacked',
      ],
      properties: {
        credentialsPacked: { const: false },
        secretValuesPacked: { const: false },
        secureStringValuesPacked: { const: false },
        privateKeysPacked: { const: false },
      },
    },
    findings: { type: 'array' },
    portabaseVersion: { type: 'string' },
  },
});

export const CURRENT_SCHEMA_VERSIONS = Object.freeze({
  kind: AWS_CAPSULE_KIND,
  capsuleFormatVersion: AWS_CAPSULE_FORMAT_VERSION,
  inventorySchemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
  profile: AWS_DEFAULT_PROFILE,
});

function fail(errors, message) {
  errors.push(message);
}

function isSemver(value) {
  return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value);
}

/**
 * Validate an AWS capsule manifest. Throws on failure.
 * @param {object} manifest
 * @returns {object} the same manifest
 */
export function validateAwsCapsuleManifest(manifest) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('AWS capsule manifest must be an object.');
  }
  if (manifest.kind !== AWS_CAPSULE_KIND) {
    fail(errors, `kind must be ${AWS_CAPSULE_KIND}`);
  }
  if (!isSemver(manifest.capsuleFormatVersion)) {
    fail(errors, 'capsuleFormatVersion must be semver (e.g. 2.0.0)');
  }
  if (!isSemver(manifest.inventorySchemaVersion)) {
    fail(errors, 'inventorySchemaVersion must be semver (e.g. 1.0.0)');
  }
  if (manifest.profile !== AWS_DEFAULT_PROFILE) {
    fail(errors, `profile must be ${AWS_DEFAULT_PROFILE} in this format version`);
  }
  if (!manifest.account || !/^[0-9]{12}$/.test(manifest.account.accountId || '')) {
    fail(errors, 'account.accountId must be a 12-digit AWS account id');
  }
  if (!Array.isArray(manifest.regions) || manifest.regions.length === 0) {
    fail(errors, 'regions must be a non-empty array');
  }
  if (!manifest.scripted || typeof manifest.scripted !== 'object') {
    fail(errors, 'scripted layer is required');
  }
  if (!manifest.binaryReferences || typeof manifest.binaryReferences !== 'object') {
    fail(errors, 'binaryReferences layer is required');
  }
  const measurement = manifest.measurement || {};
  if (typeof measurement.scriptedEstimateBytes !== 'number' || measurement.scriptedEstimateBytes < 0) {
    fail(errors, 'measurement.scriptedEstimateBytes must be a non-negative number');
  }
  if (typeof measurement.binaryFootprintGiB !== 'number' || measurement.binaryFootprintGiB < 0) {
    fail(errors, 'measurement.binaryFootprintGiB must be a non-negative number');
  }
  const coverage = manifest.coverage || {};
  if (coverage.proven !== false) {
    fail(errors, AWS_COVERAGE_CLAIMS.note);
  }
  if (coverage.match !== false) {
    fail(errors, 'coverage.match must stay false until an AWS restore drill exists');
  }
  if (coverage.binariesInCapsule !== false) {
    fail(errors, 'exclude-binaries profile forbids binariesInCapsule=true');
  }
  const secrets = manifest.secretsPolicy || {};
  for (const key of [
    'credentialsPacked',
    'secretValuesPacked',
    'secureStringValuesPacked',
    'privateKeysPacked',
  ]) {
    if (secrets[key] !== false) fail(errors, `secretsPolicy.${key} must be false`);
  }

  const secretHits = findForbiddenSecrets(manifest);
  for (const hit of secretHits) {
    fail(errors, `forbidden secret field at ${hit.path}`);
  }

  if (errors.length) {
    throw new Error(`AWS capsule manifest invalid:\n- ${errors.join('\n- ')}`);
  }
  return manifest;
}

export function emptySecretsPolicy() {
  return {
    credentialsPacked: false,
    secretValuesPacked: false,
    secureStringValuesPacked: false,
    privateKeysPacked: false,
  };
}

export function unprovenCoverage({ scriptedComplete = false } = {}) {
  return {
    proven: false,
    match: false,
    binariesInCapsule: false,
    scriptedComplete,
    restoreDrill: AWS_COVERAGE_CLAIMS.restoreDrill,
    note: AWS_COVERAGE_CLAIMS.note,
  };
}
