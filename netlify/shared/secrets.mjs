import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

const VALUE_FIELDS = ['value', 'secret', 'secret_value', 'val'];

function normalized(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function findBundleValue(bundle, { service, key, envName }) {
  const wantedService = normalized(service);
  const wantedKey = normalized(key);
  const wantedEnv = normalized(envName);
  const queue = [bundle];
  while (queue.length) {
    const current = queue.shift();
    if (Array.isArray(current)) { queue.push(...current); continue; }
    if (!current || typeof current !== 'object') continue;
    const recordService = normalized(current.service);
    const recordKey = normalized(current.key || current.name || current.id);
    const active = current.disabled !== true && current.stale !== true && current.active !== false;
    const match = (recordService === wantedService && recordKey === wantedKey) || recordKey === wantedEnv;
    if (active && match) {
      for (const field of VALUE_FIELDS) if (typeof current[field] === 'string' && current[field]) return current[field];
    }
    for (const [name, value] of Object.entries(current)) {
      if (normalized(name) === wantedEnv && typeof value === 'string' && value) return value;
      if (typeof value === 'object' && value) queue.push(value);
    }
  }
  return null;
}

export async function resolveServerSecret(envName, selector) {
  try {
    const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    const response = await client.send(new GetSecretValueCommand({ SecretId: process.env.SECRETS_BUNDLE_ID || 'secrets-bundle' }));
    const raw = response.SecretString || Buffer.from(response.SecretBinary || '').toString('utf8');
    const value = findBundleValue(JSON.parse(raw), { ...selector, envName });
    if (value) return value;
    console.warn('payment_secret_resolution=record_missing');
  } catch {
    console.warn('payment_secret_resolution=aws_unreachable');
  }
  const fallback = process.env[envName];
  if (fallback) {
    console.warn('payment_secret_resolution=fallback_used');
    return fallback;
  }
  console.error('payment_secret_resolution=fallback_missing');
  throw new Error(`Server configuration is missing ${envName}.`);
}
