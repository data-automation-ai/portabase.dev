// Fixed operational messages only. Never interpolate runner payloads or raw errors.
const messages = Object.freeze({
  'backup.completed': ['Backup finished', 'Your runner reported that a backup finished. This does not confirm a tested restore.'],
  'backup.failed': ['Backup needs attention', 'Your runner reported a backup problem. Open your private runner for details.'],
  'verify.failed': ['Verification needs attention', 'Your runner reported a verification problem. Open your private runner for details.'],
  'verify.completed': ['Verification checks finished', 'Your runner reported that verification checks finished. This does not confirm a tested restore.'],
  'schedule.missed': ['Scheduled backup missed', 'Your runner reported a missed schedule. Open your private runner to investigate.'],
  'restore.completed': ['Restore finished', 'Your runner reported that a restore finished. Check the recovered application before relying on it.'],
  'restore.failed': ['Restore needs attention', 'Your runner reported a restore problem. Open your private runner for details.'],
});

/** Output is safe for either email or SMS; transport and recipient verification are separate. */
export function notificationMessage(event, preferences = {}) {
  if (!event || !Object.hasOwn(messages, event.eventType)) return null;
  const failure = ['backup.failed', 'verify.failed', 'restore.failed', 'schedule.missed'].includes(event.eventType);
  if ((failure ? preferences.onFailure : preferences.onSuccess) !== true) return null;
  const [subject, detail] = messages[event.eventType];
  return {
    subject: `Portabase: ${subject}`,
    text: `${detail} https://portabase.dev/app`,
    eventType: event.eventType,
  };
}
