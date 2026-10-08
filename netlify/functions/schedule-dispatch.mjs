import { createManagedScheduleDispatcher } from '../shared/managed-schedule-dispatch.mjs';
// Scheduled invocation only. No public redirect or caller-controlled account.
export const config = { schedule: '* * * * *' };
export default async function scheduleDispatch() {
  try { console.info('schedule_dispatch', JSON.stringify(await createManagedScheduleDispatcher()())); }
  catch { throw new Error('schedule_dispatch_failed'); }
}
