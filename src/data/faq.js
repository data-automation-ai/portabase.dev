/**
 * Homepage Q&A. Honest answers only — no invented stats, no fake proven-green.
 * Keep in lockstep with never-hold-keys, product.js (Cloud Free / $7 / $17), and proof-lamp law.
 */
export const HOMEPAGE_FAQ = Object.freeze([
  Object.freeze({
    q: 'Do you ever see my Supabase keys?',
    a: 'With the open-source CLI in your account, your credentials stay on your runner. Our managed design uses a Google Confidential Space VM with Intel TDX: an independent verifier should check the signed image and workload key before sending encrypted credentials. The workload uses those credentials while running in our Google project. The enclave has passed isolated attestation tests, but the public flow and full recovery drill are not complete.',
  }),
  Object.freeze({
    q: 'What is an escape package vs an official backup?',
    a: 'An escape package is a customer-owned encrypted capsule of database, Auth, Storage object bytes, and Edge Functions that you can still reach if the Supabase dashboard is locked. Official platform backups cover the database volume — not Storage files — and they still sit behind the same account door. Supabase is an excellent product; the escape is for the day that door does not open.',
  }),
  Object.freeze({
    q: 'Can I run completely free?',
    a: 'Yes. The open-source CLI is free. Registered users are intended to get one manual managed run up to 10 GB per 24 hours; the hosted path remains in validation. An external capsule destination is optional for managed direct restore. Use the table sizer and exclusions to fit the cap; omitted data is marked NOT COVERED. The free plan has no scheduled service.',
  }),
  Object.freeze({
    q: 'Free CLI vs Cloud — what do I pay for?',
    a: 'The open-source engine is unlimited and free to run yourself. The planned Cloud offer gives registered users one manual run up to 10 GB per 24 hours. The free plan has no scheduled service. $7/mo adds scheduling for one project up to 10 GB; $17/mo allows unlimited projects and three runs per day up to 25 GB. A customer-owned capsule vault is optional. Managed execution remains in validation.',
  }),
  Object.freeze({
    q: 'Does Cloud Free include scheduled service?',
    a: 'No. The free plan has no scheduled service. On the CLI, you supply your own schedule. The managed design uses an on-demand Google Confidential Space VM; the paid scheduling and public GUI connection to that VM still need live proof.',
  }),
  Object.freeze({
    q: 'How do I keep a Cloud capsule under the plan cap?',
    a: 'Use the dashboard table sizer. It shows per-table and per-bucket sizes from the engine inventory. Include or exclude tables and Storage buckets before a job so the capsule fits Free 10 GB, $7 10 GB, or $17 25 GB. Anything omitted is called out as NOT COVERED. The control plane gets the include list and size estimates only.',
  }),
  Object.freeze({
    q: 'Does the proof lamp go green without a real MATCH?',
    a: 'No. The lamp stays red until a real dry-run or compare from the free CLI or a Cloud Runner reports MATCH. Demo data and empty workspaces cannot turn it green.',
  }),
  Object.freeze({
    q: 'What do SMS alerts contain?',
    a: 'Status only, optional on $17. A text says the run succeeded or failed. Never keys, never the passphrase, never capsule bytes.',
  }),
  Object.freeze({
    q: 'My code is already in GitHub — isn’t that enough?',
    a: 'Probably, for code. A repo holds your application source — and likely your Edge Functions, if you deploy them from source. But no git push ever touched your data: the rows customers wrote today, Auth users, and every uploaded Storage object live only inside Supabase. Without an active, tested backup, a locked account means the code survives and the business does not. That gap — database, Auth, Storage object bytes, and Functions in one encrypted capsule you own — is the whole product. And the capsule is built to pump straight into a brand-new account, not to sit in a bucket as a hope.',
  }),
  Object.freeze({
    q: 'How is this better than a backup I’ve never restored?',
    a: 'A backup needs a tested restore. The encrypted database dump can include auth.users rows and their password hashes, alongside application data; the capsule also carries Storage bytes, Edge Function source, and an Auth cutover checklist. OAuth provider secrets, SMTP credentials, API keys, and JWT secrets still require manual configuration in a new project. The standalone CLI provides guarded replay to a blank project. Managed Cloud direct restore and optional customer-vault delivery are still being validated end to end; the proof lamp stays red until a real compare reports MATCH.',
  }),
  Object.freeze({
    q: 'Do you store my capsule?',
    a: 'The managed runner temporarily stages a capsule inside its VM; that VM is deleted after the job window. Portabase Cloud is not the durable storage of record. A customer-owned encrypted capsule in S3 or Dropbox is optional and managed delivery is still unproven.',
  }),
]);
