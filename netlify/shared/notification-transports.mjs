// Server-only adapters. Credentials must come from Portabase's own provider configuration.
// Acceptance is not a delivery receipt. Network ambiguity must not trigger automatic resend.
import { notificationCallbackUrl } from './notification-callbacks.mjs';
const phone = value => typeof value === 'string' && /^\+[1-9]\d{7,14}$/.test(value);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
const rejected = () => ({ status: 'rejected', retryable: false });
const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;

async function submit(fetchImpl, url, options, parseId) {
  try {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(10_000) });
    // A server failure can occur after enqueueing. Only 429 explicitly allows retry.
    if (response.status === 429) return { status: 'rejected', retryable: true };
    if (response.status >= 400 && response.status < 500 && response.status !== 408) return rejected();
    if (!response.ok) return { status: 'unknown' };
    const providerId = parseId(await response.json());
    return providerId ? { status: 'accepted', providerId } : { status: 'unknown' };
  } catch { return { status: 'unknown' }; }
}

/** No environment/global-secret fallback: caller must supply product-specific credentials. */
export function createNotificationTransport({ mailgun, twilio, fetchImpl = fetch } = {}) {
  return async ({ channel, to, subject, text }) => {
    if (typeof text !== 'string' || !text || text.length > 1200 || typeof subject !== 'string' || subject.length > 160 || /[\r\n]/.test(subject)) return rejected();
    if (channel === 'email') {
      if (!mailgun?.apiKey || !email(to) || !email(mailgun.from)
        || typeof mailgun.domain !== 'string' || !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(mailgun.domain)
        || !['us', 'eu'].includes(mailgun.region || 'us')) return rejected();
      const body = new FormData();
      for (const [key, value] of Object.entries({ from: mailgun.from, to, subject, text })) body.set(key, value);
      const host = mailgun.region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net';
      return submit(fetchImpl, `https://${host}/v3/${mailgun.domain}/messages`, {
        method: 'POST', headers: { Authorization: basic('api', mailgun.apiKey) }, body,
      }, data => typeof data?.id === 'string' && data.id.length <= 512 && !/[\r\n]/.test(data.id) ? data.id : null);
    }
    if (channel === 'sms') {
      if (!/^AC[0-9a-fA-F]{32}$/.test(twilio?.accountSid || '') || !twilio?.authToken || !phone(to)
        || !/^MG[0-9a-fA-F]{32}$/.test(twilio?.messagingServiceSid || '')
        || (twilio.statusCallback !== undefined && !notificationCallbackUrl('twilio', twilio.statusCallback))) return rejected();
      const body = new URLSearchParams({ To: to, MessagingServiceSid: twilio.messagingServiceSid, Body: text });
      if (twilio.statusCallback) body.set('StatusCallback', twilio.statusCallback);
      return submit(fetchImpl, `https://api.twilio.com/2010-04-01/Accounts/${twilio.accountSid}/Messages.json`, {
        method: 'POST', headers: { Authorization: basic(twilio.accountSid, twilio.authToken), 'Content-Type': 'application/x-www-form-urlencoded' }, body,
      }, data => /^SM[0-9a-fA-F]{32}$/.test(data?.sid || '') && ['accepted', 'queued', 'sending', 'sent', 'delivered'].includes(data.status) ? data.sid : null);
    }
    return rejected();
  };
}
