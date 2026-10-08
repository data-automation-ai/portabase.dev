const numericFields = ['objectCount', 'sizeBytes', 'meterBytes', 'dailyMeterBytes', 'durationMs', 'errorCount', 'tableCount', 'bucketCount', 'functionCount'];
const enumFields = {
  runnerState: ['waiting', 'starting', 'running', 'completed', 'needs_attention'],
  status: ['RUNNING', 'COMPLETE', 'SELECTIVE', 'TRIAL', 'PARTIAL', 'FAILED', 'PENDING', 'running', 'completed', 'failed', 'ready', 'online', 'offline'],
  phase: ['database', 'auth', 'storage', 'functions', 'capture', 'encrypt', 'upload', 'verify', 'restore', 'complete'],
  destinationKind: ['s3', 'aws', 'dropbox', 'gdrive', 'local', 'nas', 'azure', 'azure-blob', 'gcs', 'rclone'],
  errorClass: ['backup_error', 'storage_error', 'verify_error', 'restore_error', 'network_error'],
  edition: ['community', 'cloud', 'trial', 'standalone'],
};

export function cloudTelemetryPayload(source, occurred) {
  const payload = {};
  if (source.runnerState !== undefined && !enumFields.runnerState.includes(source.runnerState)) throw new Error('invalid_runner_state');
  for (const key of numericFields) if (Number.isSafeInteger(source[key]) && source[key] >= 0) payload[key] = source[key];
  for (const [key, allowed] of Object.entries(enumFields)) if (allowed.includes(source[key])) payload[key] = source[key];
  // A schedule is a runner's report of intent, not proof that a future wake will happen.
  if (source.nextScheduledAt !== undefined && source.nextScheduledAt !== null) {
    const value = source.nextScheduledAt;
    if (typeof value !== 'string' || value.length > 24 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)) throw new Error('invalid_schedule');
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().replace('.000Z', 'Z') !== value.replace('.000Z', 'Z') || timestamp < occurred || timestamp > occurred + 366 * 86_400_000) throw new Error('invalid_schedule');
    payload.nextScheduledAt = new Date(timestamp).toISOString();
  }
  if (typeof source.verified === 'boolean') payload.verified = source.verified;
  if (typeof source.destinationVerified === 'boolean') payload.destinationVerified = source.destinationVerified;
  if (typeof source.capsuleId === 'string' && /^[A-Za-z0-9._-]{1,160}-\d{4}-?\d{2}-?\d{2}T\d{2}-?\d{2}-?\d{2}(?:\.\d{3})?Z$/.test(source.capsuleId)) payload.capsuleId = source.capsuleId;
  for (const key of ['capsuleHash', 'manifestHash']) if (typeof source[key] === 'string' && /^[a-f0-9]{64}$/.test(source[key])) payload[key] = source[key];
  return payload;
}
