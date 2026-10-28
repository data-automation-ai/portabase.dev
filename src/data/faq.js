/**
 * Homepage Q&A. Honest answers only — no invented stats, no fake proven-green.
 * Keep aligned with Cloud Free / $9 / $17 policy and current security release gates.
 */
export const HOMEPAGE_FAQ = Object.freeze([
  Object.freeze({
    q: 'Where are my credentials and data processed?',
    a: 'The free CLI runs on infrastructure you control. Managed jobs process credentials, encryption keys and plaintext inside a Google Confidential Space Secure Enclave using Intel TDX, in a Google project operated by Portabase. Attestation checks the workload before job material is released; it is not a promise that Portabase has no operational role. Hosted provider connections also involve our OAuth bridge. Independent verifier distribution and a full recovery drill remain release gates.',
  }),
  Object.freeze({
    q: 'What is an escape package vs an official backup?',
    a: 'Portabase is an account-loss contingency, intended to complement a business-grade backup solution. A completed recovery capsule keeps the selected database, Auth records, Storage objects and Edge Functions outside the source account in storage you control. Set it up before a lockout: Portabase cannot retrieve data from an account you can no longer access, and recovery depends on what you captured and tested.',
  }),
  Object.freeze({
    q: 'Can I run completely free?',
    a: 'The open-source CLI is free to run on your own infrastructure. Cloud Free supports one project and manual runs up to 10 GB; it does not include scheduled backups. A free destination may suit a small project, but database capacity, object storage, transfer and account eligibility have separate provider limits. Check the complete recovery requirements before choosing a destination.',
  }),
  Object.freeze({
    q: 'Free CLI vs Cloud — what do I pay for?',
    a: 'With the free CLI, you provide the compute, storage and job scheduling. Cloud adds the console and managed runner. The $9 Starter policy covers one project, one backup per 24 hours and 10 GB of outbound transfer per 30-day allowance; the first binary-object snapshot is covered separately. The $17 plan supports unlimited projects, capsules up to 25 GB and three capsules per day. You provide destination storage, and managed availability must be checked before subscribing.',
  }),
  Object.freeze({
    q: 'Are backups automatic, and what does the free keep-alive beacon do?',
    a: 'Cloud Free runs backups manually. The $9 allowance of one backup per 24 hours is a usage limit, not a promise of automatic daily backups. The free, opt-in destination keep-alive beacon runs every 72 hours and may launch a runner solely for that check. A beacon is not a backup and cannot guarantee that a provider will keep a free project active or retain it.',
  }),
  Object.freeze({
    q: 'How does the $9 transfer allowance work?',
    a: 'Starter includes 10 decimal GB — 10,000,000,000 bytes — of outbound transfer across each 30-day period. Portabase covers the first binary-object snapshot outside that allowance. Later runs transfer changed binary objects and skip unchanged ones, with the retained baseline needed for recovery. Database captures remain full captures of the selected scope; they are not incremental object transfers. Review sizes and coverage before running: anything excluded is not protected, and provider storage or transfer charges are separate.',
  }),
  Object.freeze({
    q: 'Does a successful upload prove I can recover?',
    a: 'No. Transfer verification, capture completeness and a successful restore are different checks. Review the last backup’s duration, bytes and completeness result, then rehearse recovery into an isolated target and compare the restored data. An upload receipt or a green job status alone is not an independent recovery drill.',
  }),
  Object.freeze({
    q: 'What do SMS alerts contain?',
    a: 'Optional SMS on $17 contains operational status, such as a completed or failed run. Credentials, recovery keys and capsule contents do not belong in alert messages. Alert availability is separate from whether a backup or restore has been verified.',
  }),
  Object.freeze({
    q: 'My code is already in GitHub — isn’t that enough?',
    a: 'A source repository usually protects application code, not the current database rows, Auth records or uploaded files. Those need their own recovery copy. If GitHub is also your Supabase sign-in method, losing GitHub access can affect both accounts. Consider a contingency account with independent email access and its own two-factor authentication, then verify that you can restore into it.',
  }),
  Object.freeze({
    q: 'How is this better than a backup I’ve never restored?',
    a: 'The useful difference is a recovery path you have rehearsed, not a promise on a pricing page. Restore the selected database, Auth records, Storage objects and functions into a new isolated project, then test login, access policies, object contents and application behavior. Provider configuration, SMTP, project secrets and application cutover need separate attention. A free destination is an option only when all of its current limits fit; a managed end-to-end recovery drill remains a release gate.',
  }),
  Object.freeze({
    q: 'Do you store my capsule?',
    a: 'Your durable recovery copy belongs in a destination you control. Managed runners use temporary cloud working space while capturing and encrypting data; that space is not your long-term vault. S3 and Dropbox are managed delivery paths under validation, while the standalone CLI offers additional destinations. Keep the initial binary snapshot and the required incremental manifests together, and verify delivery and restore before relying on the copy.',
  }),
]);
