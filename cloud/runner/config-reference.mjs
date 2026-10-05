// Public v2 jobs carry identifiers only. The referenced configuration stays private.
export const RUNNER_ID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const PRIVATE_OPERATIONS = ['backup', 'verify', 'replay'];
export function configReference(input) {
  if (!input || input.version !== 2 || typeof input.runnerId !== 'string' || !RUNNER_ID_RE.test(input.runnerId)
    || typeof input.configRef !== 'string' || !RUNNER_ID_RE.test(input.configRef)
    || !Number.isSafeInteger(input.configRevision) || input.configRevision < 1) {
    throw Object.assign(new Error('invalid_config_reference'), { code: 'invalid_config_reference' });
  }
  return { version: 2, runnerId: input.runnerId, configRef: input.configRef, configRevision: input.configRevision };
}
