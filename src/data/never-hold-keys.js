/**
 * Canonical never-hold-keys copy. Honest: designed / checks in repo.
 * Do not claim third-party proven-green or audited isolation.
 */
export const KEYS_COPY = Object.freeze({
  kicker: 'KEY CUSTODY · CURRENT CAPABILITIES',
  headline: 'Choose where recovery runs.',
  lead: 'The open-source CLI runs in your account. The managed design runs inside Google Confidential Space with Intel TDX. Both use the same capsule engine; the managed flow is still in isolated validation.',
  paths: Object.freeze([
    Object.freeze({
      step: '01',
      kicker: 'FREE OPEN-SOURCE CLI',
      title: 'Keys stay on your machine.',
      body: 'Run the engine on infrastructure you control. It uses your credentials to contact the source and destination providers and encrypts the capsule with your passphrase. No Portabase account is required.',
    }),
    Object.freeze({
      step: '02',
      kicker: 'MANAGED CLOUD · VALIDATION',
      title: 'Google Confidential Space runs the job.',
      body: 'A small Cloud Run controller starts a temporary Intel TDX VM. The client checks Google-signed attestation and the approved image before sending encrypted commands. Full backup, vault delivery, and restore are not yet verified.',
    }),
    Object.freeze({
      step: '03',
      kicker: 'CONTROL PLANE',
      title: 'The controller manages the VM.',
      body: 'It authenticates the account and relays encrypted commands. The protected workload uses Supabase credentials during a job; data still runs on Portabase-operated Google compute. The public GUI is not connected to this validation path yet.',
    }),
  ]),
  honest: 'The Google enclave has passed live attestation and wrong-image/key rejection in an isolated test. Customer-controlled verifier distribution, durable vault delivery, public GUI integration, and a complete restore drill remain open. Use the standalone CLI on infrastructure you control when you need a path outside Portabase compute.',
  loginTitle: 'Create your account without source credentials.',
  loginBody: 'This signup form does not request Supabase service keys or your capsule passphrase. The Google Confidential Space connection remains an isolated validation flow.',
  dashTitle: 'Runner telemetry uses approved operational fields.',
  dashBody: 'Private job references omit table and bucket names. Shared manifests require consent. Legacy connection and inventory flows have not yet been replaced throughout Cloud.',
  sealTitle: 'Managed enclave setup is not public yet.',
  sealBody: 'The test verifier checks the Google Confidential Space workload before it sends encrypted commands. A customer-facing connection and complete recovery run still need live proof.',
  flow: Object.freeze([
    Object.freeze({ label: 'Your verifier', detail: 'Checks Google attestation' }),
    Object.freeze({ label: 'Intel TDX runner', detail: 'Uses credentials inside the VM' }),
    Object.freeze({ label: 'Cloud controller', detail: 'Relays encrypted commands' }),
  ]),
});
