import { resolveServerSecret } from './secrets.mjs';
import { createNotificationTransport } from './notification-transports.mjs';
import { notificationCallbackUrl } from './notification-callbacks.mjs';

// Private runtime-only mapping. AWS bundle records use the product-specific
// service/key; fallback is the exact PORTABASE_* deployment environment name.
// Never inspect or reuse generic Mailgun/Twilio or another product's credentials.
const fields = Object.freeze({
  email: [
    ['apiKey', 'PORTABASE_MAILGUN_API_KEY', 'portabase-mailgun', 'api_key'],
    ['domain', 'PORTABASE_MAILGUN_DOMAIN', 'portabase-mailgun', 'domain'],
    ['from', 'PORTABASE_MAILGUN_FROM', 'portabase-mailgun', 'from'],
  ],
  sms: [
    ['accountSid', 'PORTABASE_TWILIO_ACCOUNT_SID', 'portabase-twilio', 'account_sid'],
    ['authToken', 'PORTABASE_TWILIO_AUTH_TOKEN', 'portabase-twilio', 'auth_token'],
    ['messagingServiceSid', 'PORTABASE_TWILIO_MESSAGING_SERVICE_SID', 'portabase-twilio', 'messaging_service_sid'],
  ],
});
const safeSecret = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 4096 && !/[\r\n]/.test(value);
const emailAddress = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);

/** No provider contact here. Configuration readiness is not delivery proof. */
export async function resolveNotificationTransport(channel, { env = process.env, resolve = resolveServerSecret, fetchImpl = fetch } = {}) {
  if (!Object.hasOwn(fields, channel)) return { available: false, reason: 'unsupported_channel' };
  const enable = channel === 'email' ? 'PORTABASE_NOTIFICATION_EMAIL_ENABLED' : 'PORTABASE_NOTIFICATION_SMS_ENABLED';
  if (env.PORTABASE_NOTIFICATION_SENDING_ENABLED !== 'true' || env[enable] !== 'true') return { available: false, reason: 'disabled' };
  const receiptsEnabled = env.PORTABASE_NOTIFICATION_RECEIPTS_ENABLED === 'true';
  const callback = receiptsEnabled ? notificationCallbackUrl(channel === 'email' ? 'mailgun' : 'twilio',
    env[channel === 'email' ? 'PORTABASE_MAILGUN_WEBHOOK_URL' : 'PORTABASE_TWILIO_STATUS_CALLBACK_URL']) : null;
  if (receiptsEnabled && !callback) return { available: false, reason: 'invalid_configuration' };
  let config;
  try {
    const values = await Promise.all(fields[channel].map(async ([property, envName, service, key]) => [property, await resolve(envName, { service, key })]));
    config = Object.fromEntries(values);
  } catch { return { available: false, reason: 'configuration_missing' }; }
  if (channel === 'email') {
    config.region = env.PORTABASE_MAILGUN_REGION || 'us';
    if (!safeSecret(config.apiKey) || !emailAddress(config.from)
      || typeof config.domain !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(config.domain)
      || !['us', 'eu'].includes(config.region)) return { available: false, reason: 'invalid_configuration' };
    if (receiptsEnabled) {
      try {
        const signingKey = await resolve('PORTABASE_MAILGUN_WEBHOOK_SIGNING_KEY', { service: 'portabase-mailgun', key: 'webhook_signing_key' });
        if (!safeSecret(signingKey)) return { available: false, reason: 'invalid_configuration' };
      } catch { return { available: false, reason: 'configuration_missing' }; }
    }
  } else if (!/^AC[0-9a-fA-F]{32}$/.test(config.accountSid || '') || !safeSecret(config.authToken)
    || !/^MG[0-9a-fA-F]{32}$/.test(config.messagingServiceSid || '')) return { available: false, reason: 'invalid_configuration' };
  if (channel === 'sms' && receiptsEnabled) config.statusCallback = callback;
  const adapter = createNotificationTransport({ ...(channel === 'email' ? { mailgun: config } : { twilio: config }), fetchImpl });
  // A resolved email capability cannot be repurposed to send SMS (or vice versa).
  const transport = message => message?.channel === channel ? adapter(message) : Promise.resolve({ status: 'rejected', retryable: false });
  return { available: true, transport };
}
