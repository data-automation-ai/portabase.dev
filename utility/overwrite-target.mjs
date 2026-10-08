import { compareDatabaseInventories, PLATFORM_SCHEMA_EXCLUDES } from './portabase-core.mjs';

const quote = value => `"${String(value).replaceAll('"', '""')}"`;
export function applicationSchema(name) {
  return !PLATFORM_SCHEMA_EXCLUDES.some(pattern => pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name);
}

export function validateOverwrite({ sourceRef, targetRef, confirmation, scope, restorePlan, capture, rollback, rollbackId, rollbackHash, proof, identity, currentInventory, rollbackInventory }) {
  const full = manifest => manifest.status === 'COMPLETE'
    && ['database', 'auth', 'storage', 'functions'].every(layer => manifest.contents?.[layer]?.complete === true && !manifest.contents[layer].limited);
  if (sourceRef === targetRef) throw new Error('Overwrite can never target the source project.');
  if (confirmation !== targetRef) throw new Error('--confirm-overwrite must exactly match the target project ref.');
  if (scope !== 'app-and-auth') throw new Error('Overwrite requires --overwrite-scope app-and-auth (application schemas and Auth data).');
  if (restorePlan || !full(capture)) {
    throw new Error('Overwrite requires a complete, unfiltered recovery capsule.');
  }
  if (rollback.projectRef !== targetRef || rollback.sourceDatabaseIdentity !== identity || rollback.kind === 'delta'
    || !full(rollback)) {
    throw new Error('Rollback must be a complete full capsule from this exact target database.');
  }
  if (proof.status !== 'RECOVERY_DATA_PATH_VERIFIED' || proof.capsuleId !== rollbackId || proof.capsuleSha256 !== rollbackHash
    || proof.sourceProjectRef !== targetRef || !proof.targetProjectRef || proof.targetProjectRef === targetRef
    || !proof.database?.verified || !proof.storage?.verified || !proof.functions?.verified) {
    throw new Error('Rollback capsule needs matching successful isolated restore evidence.');
  }
  if (!compareDatabaseInventories(rollbackInventory, currentInventory).verified) {
    throw new Error('Target inventory has changed since the rollback capsule. Quiesce writers, recapture, and verify rollback.');
  }
  return true;
}

export function overwriteSql({ schemas, authTables, extensionSchemas = [] }) {
  if (schemas.some(schema => !applicationSchema(schema))) throw new Error('Refusing to drop a platform schema.');
  if (extensionSchemas.some(schema => schemas.includes(schema))) throw new Error('Move extensions out of application schemas before overwrite; automatic extension deletion is refused.');
  if (authTables.some(table => table === 'schema_migrations')) throw new Error('Auth migration history must be preserved.');
  return [
    'SET LOCAL lock_timeout = \'10s\';',
    ...schemas.map(schema => `DROP SCHEMA ${quote(schema)} CASCADE;`),
    ...(authTables.length ? [`TRUNCATE TABLE ${authTables.map(table => `"auth".${quote(table)}`).join(', ')} RESTART IDENTITY;`] : []),
  ].join('\n') + '\n';
}

// Existing cluster roles are deliberately retained. Their attributes are not a
// per-database overwrite target. New custom roles can be created transactionally.
export function rolesForOverwrite(sql, existingRoles) {
  const existing = new Set(existingRoles);
  return sql.split(/\r?\n/).filter(line => {
    const match = /^(?:CREATE|ALTER) ROLE "((?:[^"]|"")+)"/.exec(line);
    return !match || !existing.has(match[1].replaceAll('""', '"'));
  }).join('\n');
}
