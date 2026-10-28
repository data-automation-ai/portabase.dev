import {nightmares} from './nightmares.js';
import {incidentKey} from '../lib/incident-order.js';

const retiredStories = [
  {
    tag: 'ACCOUNT TAKEOVER',
    title: 'Six months of work. Gone after a cofounder was hacked.',
    body: 'The founder woke up to a missing project. Supabase audit logs later showed that a compromised cofounder account had deleted it.',
    source: 'Reddit · Apr 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1jt9kix/my_supabase_project_was_deleted_without_warning/',
    verified: 'Poster corrected the record'
  },
  {
    tag: 'PRODUCTION DOWN',
    title: '“Our app is burning, customers are angry and leaving.”',
    body: 'A Pro customer reported random full-project outages for more than two days after a routine Postgres upgrade, with every service unhealthy.',
    source: 'Reddit · Aug 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1msrwza/all_system_down_at_random_for_2_days_on_pro_plan/',
    verified: 'Firsthand user report'
  },
  {
    tag: '10 DAYS',
    title: 'Three days for a response. Still not fixed after ten.',
    body: 'A customer spending roughly €450 per month said a database problem took down the platform for days. They migrated to self-controlled servers.',
    source: 'Reddit · Oct 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1o6aayg/10_days_of_downtime_how_is_this_ok/',
    verified: 'Firsthand user report'
  },
  {
    tag: 'SERVICE RESTRICTED',
    title: 'The backup command failed when it was needed most.',
    body: 'After unexpected egress usage reached 356%, a developer reported that the app stopped loading and service restrictions prevented a one-time pg_dump.',
    source: 'Reddit · Mar 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1rle3pn/crosses_supabase_egress_limit_and_the_time_am_i/',
    verified: 'Firsthand user report'
  },
  {
    tag: 'SELF-LOCKOUT',
    title: 'One SQL statement. Every connection refused.',
    body: 'A developer set the database connection limit to zero. The dashboard and API went down, while the one-line fix required access they did not have.',
    source: 'Reddit · Mar 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1rn42ys/accidentally_locked_myself_out_of_my_supabase/',
    verified: 'Firsthand user report'
  },
  {
    tag: 'IDENTITY FAILURE',
    title: 'A changed GitHub email made the projects disappear.',
    body: 'The dashboard could not retrieve account information. The developer waited on support before discovering the login depended on the old GitHub email.',
    source: 'Reddit · Jan 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1i6jzuj/supabase_login_issues/',
    verified: 'Resolved by the poster'
  },
  {
    tag: 'PLATFORM OUTAGE',
    title: 'Auth, Storage, Realtime and the Management API failed together.',
    body: 'Supabase confirmed that an API Gateway deployment caused a multi-service outage across customer projects. The rollback restored service.',
    source: 'Reddit + official RCA · Nov 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1p5cs5w/supabase_is_down/',
    verified: 'Confirmed by Supabase CEO'
  },
  {
    tag: 'DASHBOARD OUTAGE',
    title: 'Incognito. New browser. Same result: no dashboard.',
    body: 'Users in multiple countries reported being unable to log in. A Supabase representative apologized and linked the incident report after resolution.',
    source: 'Reddit · May 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1tjlhdb/supabasecom_login_not_working_anymore/',
    verified: 'Confirmed incident'
  },
  {
    tag: 'ACCIDENTAL DELETE',
    title: 'A free-tier table was deleted with no usable customer backup.',
    body: 'The developer was told support was the only realistic hope. Supabase ultimately restored the records as a one-time exception.',
    source: 'Reddit · Jun 2024',
    href: 'https://www.reddit.com/r/Supabase/comments/1d7qyyz',
    verified: 'Resolved by support exception'
  },
  {
    tag: 'PROJECT DELETED',
    title: 'The project and its associated backups were permanently gone.',
    body: 'A GitHub discussion documents a developer deleting a project, then joining the support queue while discovering the surrounding application could no longer connect.',
    source: 'GitHub Discussions · 2025',
    href: 'https://github.com/orgs/supabase/discussions/33919',
    verified: 'Public support discussion'
  },
  {
    tag: 'BILLING BUG',
    title: 'A deleted branch kept generating charges.',
    body: 'Supabase confirmed an underlying resource was stuck while going down and promised a refund. The customer later reported the phantom branch still appearing on bills.',
    source: 'Reddit · Jan 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1qgyx97/supabase_support_not_replying_and_taking_too_much/',
    verified: 'Issue acknowledged by support'
  },
  {
    tag: '90-DAY TRAP',
    title: 'The restore button was gone. The old API address was released.',
    body: 'After a long pause, recovery meant downloading artifacts, creating a new project, restoring manually and changing the application URL and keys.',
    source: 'GitHub Discussions · Jan 2026',
    href: 'https://github.com/orgs/supabase/discussions/41710',
    verified: 'Public support guidance'
  },
  {
    tag: 'MISSING FILES',
    title: 'Database restored. Storage objects did not.',
    body: 'Supabase documentation and a long-running community thread confirm database backups contain Storage metadata—not the underlying files.',
    source: 'GitHub Discussions · 2022–2026',
    href: 'https://github.com/orgs/supabase/discussions/6755',
    verified: 'Documented platform behavior'
  },
  {
    tag: 'UNEXPLAINED LOSS',
    title: 'Every table remained. Every row was reportedly gone.',
    body: 'A user reported an intact schema with empty tables and no known destructive action. A Supabase collaborator disputed platform deletion and directed them to audit logs and support.',
    source: 'GitHub Discussions · Apr 2025',
    href: 'https://github.com/orgs/supabase/discussions/34773',
    verified: 'Unverified, disputed report'
  }
];

export function historicalCases(){
 const known=new Set(nightmares.map(row=>incidentKey(row.href)));
 const extras=retiredStories.filter(row=>row.verified!=='Documented platform behavior'&&!known.has(incidentKey(row.href))).map((row,index)=>({...row,id:'R'+(index+1),kind:'firsthand'}));
 return [...nightmares,...extras];
}
