import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { resolveServerSecret } from './secrets.mjs';
import { applyDeliveryReceipt, canonicalProviderId, findReceiptTarget } from './notification-receipt-store.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const header = (event, name) => Object.entries(event.headers || {}).find(([key]) => key.toLowerCase() === name)?.[1] || '';
const json = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const storeFactory = () => getStore({ name: 'portabase-notification-outbox', consistency: 'strong' });
function publicUrl(value) {
  if (typeof value !== 'string' || value !== value.trim()) return null;
  // Preserve the configured bytes (including explicit port/query order).
  // URL.href normalization would change what Twilio actually signs.
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? value : null; }
  catch { return null; }
}

/** Receipt processing can remain enabled after sending is disabled. */
export async function resolveReceiptConfiguration(provider, { env = process.env, resolve = resolveServerSecret } = {}) {
  if (env.PORTABASE_NOTIFICATION_RECEIPTS_ENABLED !== 'true') return null;
  const twilio = provider === 'twilio';
  if (!twilio && provider !== 'mailgun') return null;
  const url = publicUrl(env[twilio ? 'PORTABASE_TWILIO_STATUS_CALLBACK_URL' : 'PORTABASE_MAILGUN_WEBHOOK_URL']);
  if (!url) return null;
  try {
    if (twilio) {
      const [authToken, accountSid] = await Promise.all([
        resolve('PORTABASE_TWILIO_AUTH_TOKEN', { service: 'portabase-twilio', key: 'auth_token' }),
        resolve('PORTABASE_TWILIO_ACCOUNT_SID', { service: 'portabase-twilio', key: 'account_sid' }),
      ]);
      return authToken && /^AC[0-9a-fA-F]{32}$/.test(accountSid || '') ? { url, authToken, accountSid } : null;
    }
    const [signingKey, apiKey, domain] = await Promise.all([
      resolve('PORTABASE_MAILGUN_WEBHOOK_SIGNING_KEY', { service: 'portabase-mailgun', key: 'webhook_signing_key' }),
      resolve('PORTABASE_MAILGUN_API_KEY', { service: 'portabase-mailgun', key: 'api_key' }),
      resolve('PORTABASE_MAILGUN_DOMAIN', { service: 'portabase-mailgun', key: 'domain' }),
    ]);
    const region = env.PORTABASE_MAILGUN_REGION || 'us';
    return signingKey && apiKey && /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain || '') && ['us', 'eu'].includes(region)
      ? { url, signingKey, apiKey, domain, region } : null;
  } catch { return null; }
}

// Official protocol: https://www.twilio.com/docs/usage/security
// Form callbacks sign the exact configured public URL plus ALL sorted decoded
// fields, not a reserialized JSON body. Duplicate fields are rejected.
export function verifyTwilioReceipt(event, configuration) {
  if (!header(event, 'content-type').toLowerCase().startsWith('application/x-www-form-urlencoded')) return null;
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || '';
  const form = new URLSearchParams(raw), values = Object.create(null);
  for (const [key, value] of form) { if (Object.hasOwn(values, key)) return null; values[key] = value; }
  const canonical = Object.keys(values).sort().reduce((text, key) => text + key + values[key], configuration.url);
  const expected = createHmac('sha1', configuration.authToken).update(canonical).digest('base64');
  if (!safeEqual(expected, header(event, 'x-twilio-signature')) || values.AccountSid !== configuration.accountSid) return null;
  return values;
}

const smsStatuses = new Map(Object.entries({ accepted: 'accepted', queued: 'accepted', sending: 'accepted', sent: 'sent', delivered: 'delivered',
  failed: 'failed', undelivered: 'failed', canceled: 'failed' }));
const smsStatus = status => typeof status === 'string' ? smsStatuses.get(status) || null : null;
export function createTwilioReceiptHandler({ configuration = () => resolveReceiptConfiguration('twilio'), store = storeFactory, clock = Date.now } = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (Buffer.byteLength(event.body || '') > 32_768) return json(413, { error: 'body_too_large' });
    try {
      const config = await configuration(); if (!config) return json(503, { error: 'receipts_unconfigured' });
      const body = verifyTwilioReceipt(event, config); if (!body) return json(403, { error: 'invalid_signature' });
      const status = smsStatus(body.MessageStatus);
      if (!status || !/^SM[0-9a-fA-F]{32}$/.test(body.MessageSid || '')) return json(400, { error: 'invalid_receipt' });
      const result = await applyDeliveryReceipt(store(), { channel: 'sms', providerId: body.MessageSid, status,
        receiptId: `twilio:${body.MessageSid}:${body.MessageStatus}`, occurredAt: new Date(clock()).toISOString() }, clock());
      if (result.reason === 'unmapped') return json(503, { error: 'receipt_binding_pending' });
      return json(200, { received: true, applied: result.applied });
    } catch { return json(503, { error: 'receipt_processing_unavailable' }); }
  };
}

// Normal Mailgun event signatures cover timestamp+token, NOT the event body or
// URL. A valid token alone therefore never authorizes a delivered-state update.
// https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks
export function verifyMailgunReceiptSignature(payload, config, now = Date.now()) {
  const signature = payload?.signature;
  if (!signature || !/^\d{10}$/.test(String(signature.timestamp || '')) || !/^[A-Za-z0-9]{50}$/.test(signature.token || '')
    || !/^[a-f0-9]{64}$/.test(signature.signature || '') || now - Number(signature.timestamp) * 1000 > 86_400_000
    || Number(signature.timestamp) * 1000 - now > 300_000) return false;
  return safeEqual(createHmac('sha256', config.signingKey).update(String(signature.timestamp) + signature.token).digest('hex'), signature.signature);
}

/** Read the product domain's provider log; never follow callback/storage URLs.
 * https://documentation.mailgun.com/docs/inboxready/api-reference/optimize/mailgun/events/get-v3-domain_name-events
 */
export async function lookupMailgunReceipt(config, { providerId, eventId }, fetchImpl = fetch) {
  const host = config.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
  const url = new URL(`https://${host}/v3/${encodeURIComponent(config.domain)}/events`);
  url.searchParams.set('message-id', canonicalProviderId('email', providerId));
  url.searchParams.set('limit', '300'); url.searchParams.set('ascending', 'no');
  const response = await fetchImpl(url.href, { headers: { Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString('base64')}` },
    redirect: 'error', signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('provider_lookup_unavailable');
  const body = await response.json();
  const match = Array.isArray(body.items) ? body.items.find(item => item?.id === eventId
    && canonicalProviderId('email', item.message?.headers?.['message-id']) === canonicalProviderId('email', providerId)) : null;
  return match || null;
}
function mailStatus(event) {
  if (event?.flags?.['is-test-mode'] || event?.flags?.['is-system-test']) return null;
  if (event?.event === 'accepted') return 'accepted';
  if (event?.event === 'delivered') return 'delivered';
  if (event?.event === 'failed' && event.severity === 'permanent') return 'failed';
  return null; // Temporary failure may still be retried by Mailgun itself.
}
export function createMailgunReceiptHandler({ configuration = () => resolveReceiptConfiguration('mailgun'), store = storeFactory,
  lookup = lookupMailgunReceipt, clock = Date.now } = {}) {
  return async event => {
    if (event.httpMethod !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (Buffer.byteLength(event.body || '') > 65_536) return json(413, { error: 'body_too_large' });
    if (!header(event, 'content-type').toLowerCase().startsWith('application/json')) return json(415, { error: 'unsupported_media_type' });
    let payload;
    try { payload = JSON.parse(event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : event.body || ''); }
    catch { return json(400, { error: 'invalid_json' }); }
    try {
      const config = await configuration(); if (!config) return json(503, { error: 'receipts_unconfigured' });
      if (!verifyMailgunReceiptSignature(payload, config, clock())) return json(403, { error: 'invalid_signature' });
      const candidate = payload['event-data'];
      if (!candidate || typeof candidate.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(candidate.id)) return json(400, { error: 'invalid_receipt' });
      const providerId = canonicalProviderId('email', candidate.message?.headers?.['message-id']);
      const db = store();
      if (!await findReceiptTarget(db, 'email', providerId)) return json(503, { error: 'receipt_binding_pending' });
      const tokenKey = `receipt-tokens/mailgun/${hash(payload.signature.token)}`;
      const binding = hash(`${providerId}:${candidate.id}`);
      const existing = await db.getWithMetadata(tokenKey, { type: 'json' });
      if (existing && existing.data.binding !== binding) return json(403, { error: 'replayed_signature' });
      // Trust the provider's authenticated API response, never unsigned event
      // body fields (including status, recipient, owner, or provider errors).
      const proof = await lookup(config, { providerId, eventId: candidate.id });
      if (!proof) return json(503, { error: 'receipt_not_yet_verified' });
      if (proof.id !== candidate.id || canonicalProviderId('email', proof.message?.headers?.['message-id']) !== providerId) return json(503, { error: 'invalid_provider_receipt' });
      const status = mailStatus(proof);
      if (!status) return json(200, { received: true, applied: false });
      const occurred = typeof proof.timestamp === 'number' ? proof.timestamp * 1000 : NaN;
      if (!Number.isFinite(occurred) || occurred > clock() + 300_000) return json(503, { error: 'invalid_provider_receipt' });
      const reserved = await db.setJSON(tokenKey, { binding, firstSeenAt: new Date(clock()).toISOString() }, { onlyIfNew: true });
      if (!reserved.modified && (await db.getWithMetadata(tokenKey, { type: 'json' }))?.data.binding !== binding) return json(403, { error: 'replayed_signature' });
      const result = await applyDeliveryReceipt(db, { channel: 'email', providerId, status, receiptId: `mailgun:${candidate.id}`,
        occurredAt: new Date(occurred).toISOString() }, clock());
      return json(200, { received: true, applied: result.applied });
    } catch { return json(503, { error: 'receipt_processing_unavailable' }); }
  };
}
