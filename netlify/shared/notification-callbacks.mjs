const paths = Object.freeze({ twilio: '/api/notifications/twilio-receipt', mailgun: '/api/notifications/mailgun-receipt' });

/** Keep the exact configured bytes for Twilio signing. Only the product's
 * canonical HTTPS receipt route may receive message callback metadata. */
export function notificationCallbackUrl(provider, value) {
  if (!Object.hasOwn(paths, provider) || typeof value !== 'string' || value !== value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'portabase.dev' && !url.port
      && !url.username && !url.password && !url.hash && url.pathname === paths[provider] ? value : null;
  } catch { return null; }
}
