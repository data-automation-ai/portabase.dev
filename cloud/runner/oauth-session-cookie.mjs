import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const SESSION_VERSION = 1;

function cookieKey(secret) {
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new Error('Supabase OAuth session encryption is not configured.');
  }
  return createHash('sha256').update(secret).digest();
}

export function sealSupabaseSession(session, secret) {
  if (!session?.accessToken || !session?.refreshToken || !Number.isFinite(session.expiresAt)) {
    throw new Error('Supabase OAuth did not return a renewable session.');
  }
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cookieKey(secret), nonce);
  const plain = Buffer.from(JSON.stringify({
    v: SESSION_VERSION,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresAt: session.expiresAt,
  }));
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]).toString('base64url');
}

export function openSupabaseSession(value, secret) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv('aes-256-gcm', cookieKey(secret), bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const session = JSON.parse(Buffer.concat([
      decipher.update(bytes.subarray(28)), decipher.final(),
    ]).toString('utf8'));
    if (session.v !== SESSION_VERSION || typeof session.accessToken !== 'string'
      || typeof session.refreshToken !== 'string' || !Number.isFinite(session.expiresAt)) return null;
    return session;
  } catch {
    return null;
  }
}
