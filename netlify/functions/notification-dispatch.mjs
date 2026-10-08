import { createNotificationDispatcher } from '../shared/notification-dispatch.mjs';

// Scheduled functions do not expose a public invocation URL. Do not add an API redirect.
export const config = { schedule: '* * * * *' };
export default async function notificationDispatch() {
  try {
    const result = await createNotificationDispatcher()();
    console.info('notification_dispatch', JSON.stringify(result));
  } catch { throw new Error('notification_dispatch_failed'); }
}
