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
    q: 'Do you store my capsule?',
    a: 'No. Destinations are customer-owned: S3, Dropbox, Drive, NAS, Local Starter, or rclone. Portabase Cloud is not the storage of record.',
  }),
]);
