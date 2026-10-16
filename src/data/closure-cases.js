/**
 * Public, sourced reports of account lockout / closure risk.
 * Prefer durable URLs (GitHub Discussions, Reddit post IDs) ≥ ~3 months old where possible.
 * These are firsthand public posts — not legal findings, not proof of provider misconduct.
 * Always preserve exact href.
 */

export const closureReasons = [
  {
    id: 'R01',
    provider: 'Supabase',
    title: 'Billing dispute or chargeback',
    body: 'A payment dispute can freeze projects or close self-service access while the case is open. The dashboard you need to export data may be the thing that is locked.',
  },
  {
    id: 'R02',
    provider: 'Supabase',
    title: 'Automated fraud / abuse review',
    body: 'Risk systems can ban or suspend on signals you never see: disposable email, velocity, shared cards, or traffic patterns. Appeals often go through a ticket queue, not a live restore path.',
  },
  {
    id: 'R03',
    provider: 'Supabase',
    title: 'Identity / SSO lockout',
    body: 'If login depends on GitHub (or another IdP) and that identity is suspended, renamed, or lost, the Supabase dashboard can become unreachable even when the database still exists.',
  },
  {
    id: 'R04',
    provider: 'Supabase',
    title: 'Terms / AUP enforcement',
    body: 'Account and message abuse policies, multi-account free-tier limits, and content rules can result in bans. Notice windows vary; some users report discovering the ban only at sign-in.',
  },
  {
    id: 'R06',
    provider: 'Supabase',
    title: 'Support path blocked by the same ban',
    body: 'When the ban screen also appears on the support route, self-service recovery is gone. You depend on email that may not reply in production-critical hours.',
  },
  {
    id: 'R07',
    provider: 'Supabase',
    title: 'Project delete or stuck pause',
    body: 'Destructive actions and stuck lifecycle states (pausing, recovery mode) can strand data while the only recovery tools live behind the same dashboard.',
  },
];

/** Sourced public Supabase cases — exact permanent-ish URLs retained */
export const closureCases = [
  {
    id: 'C18', provider: 'Supabase', platform: 'GitHub Discussions', date: '2026-08-12', impact: 2,
    tag: 'MFA LOCKOUT · PRODUCTION FIX BLOCKED',
    title: 'Unexpected MFA prompt blocked a production fix',
    body: 'The poster said Supabase requested a TOTP code they had never enrolled, blocking a production fix for their education platform. They reported waiting six days after contacting support.',
    href: 'https://github.com/orgs/supabase/discussions/48980', source: 'supabase/discussions#48980',
  },
  {
    id: 'C19', provider: 'Supabase', platform: 'GitHub Discussions', date: '2026-07-25', impact: 3,
    tag: 'MFA LOCKOUT · TWO PRODUCTION PROJECTS',
    title: 'Unrecognized MFA prompt locked two production projects',
    body: 'The poster said a TOTP prompt appeared although they had never enrolled MFA. They reported being unable to use the support form and remaining locked out of two production projects for more than a week.',
    href: 'https://github.com/orgs/supabase/discussions/48326', source: 'supabase/discussions#48326',
  },
  {
    id: 'C20', provider: 'Supabase', platform: 'GitHub Discussions', date: '2026-07-15', impact: 2,
    tag: 'DASHBOARD ACCESS LOST · FOUR PROJECTS',
    title: 'Dashboard no longer showed four existing projects',
    body: 'The poster said dashboard access disappeared for four projects after a service disruption, while their applications continued serving traffic through existing API keys.',
    href: 'https://github.com/orgs/supabase/discussions/47948', source: 'supabase/discussions#47948',
  },
  {
    id: 'C21', provider: 'Supabase', platform: 'GitHub Discussions', date: '2026-04-30', impact: 2,
    tag: 'ACCOUNT BANNED · APP DOWN',
    title: 'Account ban broke an app with live users',
    body: 'The poster said a sudden ban blocked sign-in and broke a browser extension storing user data. They asked for restored access or a way to export their data.',
    href: 'https://github.com/orgs/supabase/discussions/45424', source: 'supabase/discussions#45424',
  },
  {
    id: 'C01',
    provider: 'Supabase',
    platform: 'GitHub Discussions',
    date: '2025-11-10',
    tag: 'USER BANNED',
    title: 'Production app offline after a sudden “user banned” login screen',
    body: 'Poster reported no prior warning email, inability to sign in, and a live production app depending on Supabase. A collaborator directed them to email support; others later described free-tier / temp-email recovery difficulty.',
    href: 'https://github.com/orgs/supabase/discussions/40318',
    source: 'supabase/discussions#40318',
  },
  {
    id: 'C02',
    provider: 'Supabase',
    platform: 'GitHub Discussions',
    date: '2025-10-28',
    tag: 'IDENTITY LOCKOUT',
    title: 'GitHub suspension blocked Supabase login entirely',
    body: 'Account linked to GitHub for auth. When the GitHub account was suspended, the owner could not sign in to Supabase and asked for an alternate recovery path.',
    href: 'https://github.com/orgs/supabase/discussions/39920',
    source: 'supabase/discussions#39920',
  },
  {
    id: 'C03',
    provider: 'Supabase',
    platform: 'GitHub Discussions',
    date: '2025-05-01',
    tag: 'USER BANNED',
    title: '“Banned user” blocked even changing the payment card',
    body: 'Poster needed to update a credit card but could not log in because the console showed a banned-user error — billing recovery blocked by the same ban gate.',
    href: 'https://github.com/orgs/supabase/discussions/34181',
    source: 'supabase/discussions#34181',
  },
  {
    id: 'C04',
    provider: 'Supabase',
    platform: 'Reddit',
    date: '2025-04-30',
    tag: 'BILLING FREEZE',
    title: 'Chargeback procedure froze projects and downgraded the org',
    body: 'Firsthand report: paid plan disruption, dispute, frozen projects. A Supabase reply in-thread framed the pause as chargeback procedure; access was later discussed publicly.',
    href: 'https://www.reddit.com/r/Supabase/comments/1kbj0sh/',
    source: 'r/Supabase · 1kbj0sh',
  },
  {
    id: 'C05',
    provider: 'Supabase',
    platform: 'Reddit',
    date: '2025-04-01',
    tag: 'PROJECT DELETED',
    title: 'Project deleted after cofounder account compromise (as reported)',
    body: 'Founder report that a compromised cofounder account led to project deletion. Illustrates single-account dependency even without a platform ban.',
    href: 'https://www.reddit.com/r/Supabase/comments/1jt9kix/',
    source: 'r/Supabase · 1jt9kix',
  },
  {
    id: 'C06',
    provider: 'Supabase',
    platform: 'Reddit',
    date: '2025-08-17',
    tag: 'PRODUCTION DOWN',
    title: 'Multi-day Pro outages with customers leaving',
    body: 'Detailed firsthand report of repeated full-project failures after a Postgres upgrade, limited visibility, and slow support relative to business impact.',
    href: 'https://www.reddit.com/r/Supabase/comments/1msrwza/',
    source: 'r/Supabase · 1msrwza',
  },
  {
    id: 'C07',
    provider: 'Supabase',
    platform: 'AnswerOverflow / Discord',
    date: '2025-10-25',
    tag: 'ACCOUNT BANNED',
    title: 'Paid Pro ban with no dashboard or API access for 48+ hours',
    body: 'Public support mirror: successful card payments claimed, ban without useful self-service path, thread later touched billing routing.',
    href: 'https://www.answeroverflow.com/m/1431525602867023992',
    source: 'AnswerOverflow · 1431525602867023992',
  },
  {
    id: 'C08',
    provider: 'Supabase',
    platform: 'AnswerOverflow / Discord',
    date: '2025-11-12',
    tag: 'BAN ON SUPPORT PATH',
    title: '“User is banned” also appeared when trying to reach support',
    body: 'Poster tried multiple browsers; ban screen followed them into the support path, leaving no in-product recovery UI.',
    href: 'https://www.answeroverflow.com/m/1438177383642566719',
    source: 'AnswerOverflow · 1438177383642566719',
  },
  {
    id: 'C14',
    provider: 'Supabase',
    platform: 'Reddit',
    date: '2025-01-21',
    tag: 'IDENTITY',
    title: 'Changed GitHub email made projects appear to vanish',
    body: 'Dashboard failed to retrieve account information; poster later traced the issue to the old GitHub email identity used for login.',
    href: 'https://www.reddit.com/r/Supabase/comments/1i6jzuj/',
    source: 'r/Supabase · 1i6jzuj',
  },
];

/*
 * Background archive of AWS closure reasons & cases — kept out of the active bundle
 * until the AWS recovery portion of Portabase launches:
 *
 * Reasons:
 * - R05 (AWS): Account permanently closed — AWS can permanently close an account. Associated emails may be blocked from new signups. Resources and console access disappear together if you have no external copy.
 * - R08 (AWS): Suspension with delayed human response — Account suspension emails can land before any useful dialogue. Until reinstatement, APIs and console for that account stop being a recovery plan.
 *
 * Cases:
 * - C15 (2026-09-25, Reddit r/aws · 1wq3in9): https://www.reddit.com/r/aws/comments/1wq3in9/aws_account_suspended_then_marked_closed/
 * - C16 (2026-08-25, Reddit r/aws · 1vxvk29): https://www.reddit.com/r/aws/comments/1vxvk29/aws_account_suspended_related_to_previously/
 * - C17 (2026-08-13, Reddit r/aws · 1vnm4vh): https://www.reddit.com/r/aws/comments/1vnm4vh/aws_suspended_our_production_account_for/
 * - C22 (2026-04-06, Reddit r/aws · 1sdnmum): https://www.reddit.com/r/aws/comments/1sdnmum/aws_closed_my_account_for_following_their/
 * - C09 (2023-02-20, Reddit r/aws · 1185k0g): https://www.reddit.com/r/aws/comments/1185k0g/your_aws_account_was_permanently_closed/
 * - C10 (2024-05-07, Reddit r/aws · 1ckpl5h): https://www.reddit.com/r/aws/comments/1ckpl5h/my_account_has_been_closed_i_made_a_new_one_and/
 * - C11 (2024-08-08, Reddit r/aws · 1ekt2cr): https://www.reddit.com/r/aws/comments/1ekt2cr/how_do_i_pay_the_bill_after_account_is_closed/
 * - C12 (2025-06-05, Reddit r/aws · 1l35gfh): https://www.reddit.com/r/aws/comments/1l35gfh/help_aws_account_closure_and_ongoing_billing/
 * - C13 (2025-12-01, Reddit r/aws · 1qj44kp): https://www.reddit.com/r/aws/comments/1qj44kp/does_aws_close_accounts_for_lack_of_use/
 */
