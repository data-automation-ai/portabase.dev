/**
 * Canonical never-hold-keys copy. Honest: designed / checks in repo.
 * Do not claim third-party proven-green or audited isolation.
 */
export const KEYS_COPY = Object.freeze({
  kicker: 'KEY CUSTODY · PAID SERVICE BLINDNESS',
  headline: 'The paid service is blind to your keys.',
  lead: 'Supabase is an excellent product. Portabase does not replace it. The escape package lives in storage you own — and the secrets that seal it never belong on this website.',
  paths: Object.freeze([
    Object.freeze({
      step: '01',
      kicker: 'FREE OPEN-SOURCE CLI',
      title: 'Keys stay on your machine.',
      body: 'You run the engine locally or on a VM you control. Service-role keys, database URLs, and the capsule passphrase never leave that box. No Portabase account is required.',
    }),
    Object.freeze({
      step: '02',
      kicker: 'PAID CLOUD',
      title: 'The browser seals keys to your runner only.',
      body: 'You type secrets in the browser form. They are sealed to your Cloud Runner for that job. Portabase is not a second keyholder.',
    }),
    Object.freeze({
      step: '03',
      kicker: 'CONTROL PLANE',
      title: 'This site is blind.',
      body: 'The website and Cloud APIs are allowed job status and hashes only. Never keys, never the passphrase, never capsule bytes or object names.',
    }),
  ]),
  honest: 'This is the designed path, with checks in this repo. It is not a third-party audited, proven-green isolation guarantee. If you need zero Portabase key path, use the free open-source CLI on infrastructure only you operate.',
  loginTitle: 'Keys are never posted to Portabase servers.',
  loginBody: 'This form creates a Cloud account. Supabase keys and the capsule passphrase are not collected here. On Cloud, the browser seals those secrets to your runner only. This site is allowed status and hashes.',
  dashTitle: 'Telemetry is status and hashes only.',
  dashBody: 'No keys. No passphrase. No capsule bytes. The control plane stores job metadata and hashes — never sealing material.',
  sealTitle: 'Browser seals to your runner only.',
  sealBody: 'Paste the runner seal URL. This console refuses any Portabase /api address. Secrets stay in this browser until they POST to that runner — never to this website.',
  flow: Object.freeze([
    Object.freeze({ label: 'Your browser', detail: 'You type secrets here' }),
    Object.freeze({ label: 'Your Cloud Runner', detail: 'Keys sealed for the job' }),
    Object.freeze({ label: 'Portabase site', detail: 'Status + hashes only' }),
  ]),
});
