import { CompactEncrypt, compactDecrypt } from 'jose';
const TYPE = 'portabase-customer-connections-v1';
export const recoveryKeyBytes = value => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value || '')) throw new Error('recovery_key_required');
  const key = Buffer.from(value,'base64url');
  if (key.length !== 32) throw new Error('invalid_recovery_key');
  return key;
};
export async function sealProfile(profile, recoveryKey) {
  const key = recoveryKeyBytes(recoveryKey);
  const plaintext = new TextEncoder().encode(JSON.stringify(profile));
  try { return await new CompactEncrypt(plaintext).setProtectedHeader({alg:'dir',enc:'A256GCM',typ:TYPE}).encrypt(key); }
  finally { key.fill(0); plaintext.fill(0); }
}
export async function openProfile(sealed, recoveryKey, owner) {
  const key = recoveryKeyBytes(recoveryKey);
  try {
    if (typeof sealed !== 'string' || sealed.length > 131072) throw new Error('invalid_profile');
    const decoded = await compactDecrypt(sealed,key,{keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']});
    if (decoded.protectedHeader.typ !== TYPE) throw new Error('invalid_profile');
    const profile = JSON.parse(new TextDecoder().decode(decoded.plaintext)); decoded.plaintext.fill(0);
    if (profile.version !== 1 || profile.owner !== owner || !profile.connections || typeof profile.connections !== 'object') throw new Error('profile_owner_mismatch');
    return profile;
  } catch { throw new Error('profile_unlock_failed'); }
  finally { key.fill(0); }
}
