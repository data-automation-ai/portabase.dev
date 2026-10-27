// Original 2026 incidents reviewed on 2026-10-27. Related reports count once.
export const researchOfficial2026 = [
  ['2026-09-24', 'HARDWARE FAILURE', 'An underlying hardware problem left some European projects unhealthy.', 'Supabase identified a hardware issue affecting a subset of projects in eu-west-1. The affected projects were moved to new hardware and service was restored; this was not described as every project in the region failing.', 'czcxy9zjx7kt'],
  ['2026-09-24', 'DASHBOARD ACCESS', 'Permission errors blocked dashboard operations.', 'Supabase recorded a critical incident involving permission errors in its dashboard. The provider applied a fix and resolved the incident. The report does not establish customer database loss or an outage of every running application.', 'ftwdxhst1yns'],
  ['2026-09-10', 'PROJECTS UNRESPONSIVE', 'Some Nano projects became unresponsive after running for hours.', 'Supabase identified an issue affecting Nano projects and rolled out a fix globally. It advised restarting projects that remained affected and noted that some disk-I/O warning emails were incorrect.', '4mkcsnlf6p5x'],
  ['2026-09-04', 'RECOVERY OPERATIONS', 'A global incident disabled project changes and delayed backups.', 'Supabase temporarily disabled lifecycle actions including creation, configuration changes, restarts and resizing while addressing elevated errors. Backups were delayed. Existing running projects, data APIs and direct Postgres connections were explicitly unaffected.', 'm2r2sgmsnw2g'],
  ['2026-09-01', 'DASHBOARD LOCKOUT', 'A dashboard login outage blocked project administration.', 'Supabase confirmed that users could not log in and that logged-out users could not perform dashboard administrative actions. It rolled back a recent change and restored access; customer projects were unaffected.', 'vfb32z24wt64'],
  ['2026-08-28', 'DATABASE UNREACHABLE', 'A library dependency failure affected Postgres 15 projects in multiple regions.', 'Supabase reported that affected projects could not load Supautils because a required GLIBC version was missing. The provider rolled back the change and resolved the incident. The retrospective notice does not establish an exact outage duration.', 'm3rr3q187n3b'],
  ['2026-08-27', 'DATA API ERRORS', 'Some data API requests encountered increased latency and errors.', 'Supabase investigated elevated response times and errors affecting a subset of requests. Its updates described a PostgREST rollout and eventual resolution. The multi-day incident window should not be read as continuous total downtime for every customer.', 'bv4ntm4x0btf'],
  ['2026-08-14', 'REGIONAL ACCESS', 'Project access and changes were disrupted in Ohio.', 'Supabase confirmed an incident affecting project access, updates and creation in us-east-2. It deployed a fix and reported recovery for impacted projects. This was a regional incident, distinct from its February outage.', 'ctvf19frbkw4'],
  ['2026-07-30', 'FUNCTION DEPLOYMENTS', 'Bulk Edge Function deployments and updates failed for some customers.', 'Supabase acknowledged failures affecting bulk deployments and updates to existing Edge Functions. Individual redeployment was a workaround for some users. A preventive fix shipped in CLI 2.111.0; support continued assisting exceptional cases.', 'y0tjlh6hhxlv'],
  ['2026-07-17', 'BACKUP AND RESTORE', 'Project actions, backups and recovery operations failed in several regions.', 'Supabase reported failures affecting pause/unpause, restoration, PITR operations and backups across several Americas regions. It mitigated the incident and requeued affected jobs before reporting recovery.', 'xhs8d4l3wtsc'],
].map(([date, tag, title, body, incident], index) => ({
  id: `E${String(1 + index).padStart(2, '0')}`, kind: 'official', date, tag, title, body,
  source: `Supabase Status · ${date}`,
  href: `https://${incident.startsWith('01M') ? 'status.supabase.com' : 'supabase.statuspage.io'}/incidents/${incident}`,
  verified: 'Official incident report · resolved · scope and recovery preserved',
}));

researchOfficial2026.push(
  {
    id: 'E14', kind: 'official', date: '2026-02-24', tag: 'REGIONAL NETWORK BLOCKS',
    title: 'Network blocks made Supabase unreachable in India and Yemen.',
    body: 'Supabase documented separate regional blocks in 2026: carrier-level blocking in Yemen during February 2–10, and an Indian government domain restriction during February 24–March 3. Both were lifted. These were network-access restrictions, not confirmed database loss or a platform security breach.',
    source: 'Supabase postmortem · Feb–Mar 2026', href: 'https://supabase.com/blog/navigating-regional-network-blocks',
    verified: 'Official account · two related regional examples grouped into one entry · resolved',
  },
  {
    id: 'E15', kind: 'official', date: '2026-02-12', tag: 'REGIONAL OUTAGE',
    title: 'Ohio lost external connectivity for 3 hours and 42 minutes.',
    body: 'Supabase reported that a deployment accidentally enabled AWS VPC Block Public Access, cutting external connectivity to services in us-east-2. Rolling back the change restored service. Its postmortem attributes the incident to its deployment, not an AWS-wide outage or attack.',
    source: 'Supabase postmortem · Feb 12, 2026', href: 'https://supabase.com/blog/supabase-incident-on-february-12-2026',
    verified: 'Official postmortem · cause and recovery documented',
  },
);
