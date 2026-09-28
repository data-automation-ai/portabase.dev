/**
 * Sleeping runner process. Waits for a browser-sealed job, then calls the free engine.
 * Control plane talks lifecycle only — this file never exposes get-key or SSH.
 */

import { createSleepingRunner } from './agent.mjs';

const subscriberId = process.env.PORTABASE_RUNNER_SUBSCRIBER_ID || 'unassigned';
const region = process.env.PORTABASE_RUNNER_REGION || 'us-east-1';
const runner = createSleepingRunner({ subscriberId, region });

console.log(JSON.stringify({
  ok: true,
  role: 'cloud-runner',
  status: runner.status,
  runnerId: runner.runnerId,
  region: runner.region,
  engine: runner.engine,
  note: 'Sleeping empty. Waiting for a sealed transfer. No keys in this image.',
}));

const keepAlive = setInterval(() => {
  process.stdout.write('');
}, 60_000);
if (typeof keepAlive.unref === 'function') keepAlive.unref();
