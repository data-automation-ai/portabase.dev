/**
 * Homepage Q&A. Honest answers only — no invented stats, no fake proven-green.
 * Keep in lockstep with never-hold-keys, product.js (Cloud Free / $7 / $17), and proof-lamp law.
 */
export const HOMEPAGE_FAQ = Object.freeze([
  Object.freeze({
    q: 'Do you ever see my Supabase keys?',
    a: 'No. On the free open-source CLI, keys stay on the machine you run. On Cloud, the browser seals keys to your runner only. The Portabase control plane is blind — status and hashes, never keys, passphrase, or capsule bytes.',
  }),
  Object.freeze({
    q: 'What is an escape package vs an official backup?',
    a: 'An escape package is a customer-owned encrypted capsule of database, Auth, Storage object bytes, and Edge Functions that you can still reach if the Supabase dashboard is locked. Official platform backups cover the database volume — not Storage files — and they still sit behind the same account door. Supabase is an excellent product; the escape is for the day that door does not open.',
  }),
  Object.freeze({
    q: 'Can I run completely free?',
    a: 'Yes, when the capsule fits a free destination — or when you use --exclude-binaries or leave out a huge unimportant table so the rest fits. Cloud Free is one project, 100 MB, manual only: the free plan has no scheduled service. The Cloud table sizer shows those sizes before a job. There is no fake percentage. Production-sized full capsules with all Storage bytes will not fit on a free destination.',
  }),
  Object.freeze({
    q: 'Free CLI vs Cloud — what do I pay for?',
    a: 'The open-source engine is unlimited and free (you run it — friction: install, disk, cron). Cloud Free is 100 MB, one project, manual only. The free plan has no scheduled service. Paid Cloud is $7 (one database, 10 GB, 1 capsule / 24h) or $17 (unlimited databases, 25 GB, 3 capsules / day) for GUI, guided configuration, telemetry, managed schedules, and optional SMS on $17. You still bring capsule storage.',
  }),
  Object.freeze({
    q: 'Does Cloud Free include scheduled service?',
    a: 'No. The free plan has no scheduled service — no cron, no daily escape schedule, manual ops only. Never-hold-keys is the same as paid: keys stay local on the CLI or seal to your runner on Cloud. Paid $7 and $17 keep managed/scheduled service and the rest of Cloud convenience. The open-source CLI remains the unlimited free path with friction.',
  }),
  Object.freeze({
    q: 'How do I keep a Cloud capsule under the plan cap?',
    a: 'Use the dashboard table sizer. It shows per-table and per-bucket sizes from the free engine doctor / size inventory — no new CLI capture flags. Include or exclude tables and Storage buckets before a job so the capsule fits Cloud Free 100 MB, $7 10 GB, or $17 25 GB. Anything omitted is called out as NOT COVERED. The control plane gets the include list and size estimates only — never keys or row bodies.',
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
    a: 'A backup that has never been through an emergency restore is a hope, not a plan. Portabase capsules are built to replay straight into a brand-new Supabase project — often a free one under 500 MB — while the original account is still locked: database, Storage object bytes, and Edge Functions pump straight in. The one deliberate exception is Auth — and no automation can do it, ours or anyone else’s: providers, SMTP, API keys, and the JWT secret are per-project and cannot travel. So the capsule carries user identities as an inventory plus AUTH-CUTOVER.md, step-by-step manual instructions for re-creating providers and re-onboarding users, written before you need them. The restore is also something you rehearse: portabase replay --confirm-target <NEW_REF> proves the path on your schedule, and the proof lamp stays red until a real dry-run or compare reports MATCH. Recovery you have tested beats recovery you have merely scheduled.',
  }),
  Object.freeze({
    q: 'Do you store my capsule?',
    a: 'No. Destinations are customer-owned: S3, Dropbox, Drive, NAS, Local Starter, or rclone. Portabase Cloud is not the storage of record.',
  }),
]);
