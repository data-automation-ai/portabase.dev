/**
 * Canonical never-hold-keys copy. Honest: designed / checks in repo.
 * Do not claim third-party proven-green or audited isolation.
 */
export const KEYS_COPY = Object.freeze({
  kicker: 'KEY CUSTODY · CURRENT CAPABILITIES',
  headline: 'Keep recovery credentials on infrastructure you control.',
  lead: 'Supabase is an excellent product. Portabase does not replace it. The escape package lives in storage you own — and the secrets that seal it never belong on this website.',
  paths: Object.freeze([
    Object.freeze({
      step: '01',
      kicker: 'FREE OPEN-SOURCE CLI',
      title: 'Keys stay on your machine.',
      body: 'Run the engine on infrastructure you control. It uses your credentials to contact the source and destination providers and encrypts the capsule with your passphrase. No Portabase account is required.',
    }),
    Object.freeze({
      step: '02',
      kicker: 'PAID CLOUD',
      title: 'Private runner hosting is still being built.',
      body: 'The private selection GUI can save configuration on a runner you operate. Managed provisioning and browser-to-runner credential sealing are not available yet.',
    }),
    Object.freeze({
      step: '03',
      kicker: 'CONTROL PLANE',
      title: 'Choose what the account dashboard receives.',
      body: 'The private job path sends references and operational status. Manifest sharing requires consent. Older connection and selection flows still send credentials or inventory through the backend and are awaiting replacement.',
    }),
  ]),
  honest: 'Cloud does not yet provide a verified zero-knowledge service. Managed runners, key custody and the remaining legacy flows need implementation and live verification. Use the standalone CLI on infrastructure you control for the currently available independent recovery path.',
  loginTitle: 'Create your account without source credentials.',
  loginBody: 'This signup form does not request Supabase service keys or your capsule passphrase. Private runner provisioning and credential sealing are still under development.',
  dashTitle: 'Runner telemetry uses approved operational fields.',
  dashBody: 'Private job references omit table and bucket names. Shared manifests require consent. Legacy connection and inventory flows have not yet been replaced throughout Cloud.',
  sealTitle: 'Private runner setup is not available yet.',
  sealBody: 'The private interface and credential-sealing connection still need to be implemented and verified.',
  flow: Object.freeze([
    Object.freeze({ label: 'Private GUI', detail: 'Selections on your runner' }),
    Object.freeze({ label: 'Runner you operate', detail: 'Uses its configured credentials' }),
    Object.freeze({ label: 'Account dashboard', detail: 'References and operational status' }),
  ]),
});
