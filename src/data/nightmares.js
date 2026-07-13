export const nightmares = [
  {
    id: 'N01', kind: 'firsthand', tag: 'ACCOUNT BANNED',
    title: 'A paid Pro account was banned and the database went dark.',
    body: 'The customer reported successful company-card payments, no warning, no dashboard or API access, and no support response after 48 hours. The visible thread later routed the case to billing.',
    source: 'AnswerOverflow · Oct 25, 2025',
    href: 'https://www.answeroverflow.com/m/1431525602867023992',
    verified: 'Substantive public support thread · resolution not visible'
  },
  {
    id: 'N02', kind: 'firsthand', tag: 'ACCOUNT BANNED',
    title: 'GitHub login showed “User is banned”—including on the support path.',
    body: 'The user tried multiple browsers while attempting to reactivate an instance. The same ban screen appeared when they followed the support route, leaving no self-service path back in.',
    source: 'AnswerOverflow · Nov 12, 2025',
    href: 'https://www.answeroverflow.com/m/1438177383642566719',
    verified: 'Substantive public support thread · resolution not visible'
  },
  {
    id: 'N03', kind: 'firsthand', tag: 'ACCOUNT BANNED',
    title: 'A company-email account was unexpectedly banned.',
    body: 'The user said the account used an official company address and denied malicious schema or Function content. The thread ends with instructions to contact support; no public resolution appears.',
    source: 'AnswerOverflow · May 12, 2026',
    href: 'https://www.answeroverflow.com/m/1503591699413340340',
    verified: 'Substantive public support thread · unresolved publicly'
  },
  {
    id: 'N04', kind: 'firsthand', tag: 'DATABASE UNREACHABLE',
    title: 'A production database remained in recovery mode for 24 hours.',
    body: 'The customer reported no database connections, failed backup retrieval, and no support response while the dashboard showed the database was not accepting connections.',
    source: 'AnswerOverflow · Sep 7, 2025',
    href: 'https://www.answeroverflow.com/m/1414123910621958174',
    verified: 'Error details and support discussion preserved'
  },
  {
    id: 'N05', kind: 'firsthand', tag: 'PROJECT STUCK',
    title: 'A restart became a project stuck in “Pausing.”',
    body: 'While troubleshooting missing tables, the user restarted, transferred, and paused the project. The dashboard then became stuck and table access remained unavailable while they sought escalation.',
    source: 'AnswerOverflow · Apr 4, 2026',
    href: 'https://www.answeroverflow.com/m/1489915521368326164',
    verified: 'Substantive public support thread'
  },
  {
    id: 'N06', kind: 'firsthand', tag: 'BILLING FREEZE',
    title: 'A billing dispute froze projects and downgraded the organization.',
    body: 'The poster said a paid plan disappeared during migration, a dispute followed, and projects were frozen. A Supabase response described the pause as chargeback procedure and later unblocked the account.',
    source: 'Reddit · Apr 30, 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1kbj0sh/',
    verified: 'Firsthand report · Supabase response and resolution preserved'
  },
  {
    id: 'N07', kind: 'firsthand', tag: 'PHANTOM BILLING',
    title: 'A deleted branch kept generating charges.',
    body: 'Support reportedly found the branch stuck in a GOING_DOWN state and promised a refund. The customer later said the phantom resource still appeared on subsequent billing.',
    source: 'Reddit · Jan 19, 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1qgyx97/',
    verified: 'Firsthand report · support acknowledgement quoted by poster'
  },
  {
    id: 'N08', kind: 'firsthand', tag: 'PRODUCTION DOWN',
    title: 'A Pro production project failed repeatedly for more than two days.',
    body: 'After a minor Postgres upgrade, the customer reported random full-project outages, angry departing customers, no useful logs, and no timely support response.',
    source: 'Reddit · Aug 17, 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1msrwza/',
    verified: 'Detailed firsthand production-impact report'
  },
  {
    id: 'N09', kind: 'firsthand', tag: 'TEN DAYS',
    title: 'Branching and upgrade failures reportedly stalled work for ten days.',
    body: 'The customer described eu-west-2 downtime that blocked a branching-dependent deployment process while upgrade problems prevented scaling or creating a replacement.',
    source: 'Reddit · Oct 14, 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1o6aayg/',
    verified: 'Detailed firsthand operational-impact report'
  },
  {
    id: 'N10', kind: 'firsthand', tag: 'IDENTITY LOCKOUT',
    title: 'A changed GitHub identity made every project appear to disappear.',
    body: 'The dashboard failed to retrieve account information and left projects loading indefinitely. The poster later traced the lockout to the old GitHub email identity.',
    source: 'Reddit · Jan 21, 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1i6jzuj/',
    verified: 'Firsthand report · cause and resolution supplied by poster'
  },
  {
    id: 'N11', kind: 'firsthand', tag: 'MULTI-SERVICE OUTAGE',
    title: 'Auth and data access failed together across customer projects.',
    body: 'The poster reported that authentication and data were unavailable. The linked status incident later confirmed failing requests across multiple services and customer projects before recovery.',
    source: 'Reddit + Supabase Status · Nov 24, 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1p5cs5w/',
    verified: 'User impact corroborated by official incident'
  },
  {
    id: 'N12', kind: 'firsthand', tag: 'PROJECT STUCK',
    title: 'Pausing to fix an I/O problem removed all project access.',
    body: 'The user paused a project while dashboard access was already degraded. It remained stuck in Pausing: not actually paused, but with the dashboard and services inaccessible.',
    source: 'Reddit · Apr 15, 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1smif95/',
    verified: 'Detailed firsthand report'
  },
  {
    id: 'N13', kind: 'firsthand', tag: 'SELF-LOCKOUT',
    title: 'One connection-limit command locked out the API and dashboard.',
    body: 'After setting the Postgres database connection limit to zero, every connection was refused. The one-line repair required the very database access the user had removed.',
    source: 'Reddit · Mar 7, 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1rn42ys/',
    verified: 'Detailed reproducible firsthand report'
  },
  {
    id: 'N14', kind: 'firsthand', tag: 'EXPORT BLOCKED',
    title: 'Egress restrictions arrived before the emergency backup.',
    body: 'After exceeding an egress allowance, the user reported the application stopped loading and an attempted one-time database download was unavailable while important test data remained inside.',
    source: 'Reddit · Mar 5, 2026',
    href: 'https://www.reddit.com/r/Supabase/comments/1rle3pn/',
    verified: 'Firsthand restriction and recovery-dependency report'
  },
  {
    id: 'N15', kind: 'firsthand', tag: 'ACCOUNT TAKEOVER',
    title: 'A compromised cofounder account deleted six months of work.',
    body: 'The founder first believed Supabase had deleted the project. Audit evidence later pointed to a compromised cofounder account. The correction makes this an account-takeover case, not a platform-deletion claim.',
    source: 'Reddit · Apr 7, 2025',
    href: 'https://www.reddit.com/r/Supabase/comments/1jt9kix/',
    verified: 'Poster correction preserved prominently'
  },
  {
    id: 'N16', kind: 'firsthand', tag: 'EMPTY RESTORE',
    title: 'A project resumed after a pause with the expected data missing.',
    body: 'The poster described restoring after roughly two months of pause and seeing an effectively empty project. The thread contains mixed later outcomes, including support-assisted recoveries.',
    source: 'Reddit · Dec 28, 2022',
    href: 'https://www.reddit.com/r/Supabase/comments/zwx378/',
    verified: 'Firsthand report · mixed resolutions preserved'
  },
  {
    id: 'N17', kind: 'firsthand', tag: 'TABLE DELETED',
    title: 'An entire table was deleted with no customer-held backup.',
    body: 'The free-plan user had no scheduled backup or downloaded records. Supabase reportedly restored the data as a one-time exception—support discretion, not a repeatable recovery plan.',
    source: 'Reddit · Jun 4, 2024',
    href: 'https://www.reddit.com/r/Supabase/comments/1d7qyyz/',
    verified: 'Firsthand report · support exception preserved'
  },
  {
    id: 'N18', kind: 'firsthand', tag: 'EXPIRED PROJECT',
    title: 'After 90 days, recovery became a manual backup-file migration.',
    body: 'The project could no longer be resumed in place. The user had a downloaded backup artifact but could not find a clear path to restore it into a new project with new URLs and keys.',
    source: 'Reddit · Oct 13, 2024',
    href: 'https://www.reddit.com/r/Supabase/comments/1g2y2k4/',
    verified: 'Detailed firsthand recovery request'
  },
  {
    id: 'N19', kind: 'firsthand', tag: 'SERVICE RESTRICTED',
    title: 'Restrictions remained after the reported overage was cleared.',
    body: 'The user said Storage usage was reduced and a new billing cycle had started, yet the project remained restricted. The visible support discussion did not show a final resolution.',
    source: 'GitHub Discussions · Aug 25, 2025',
    href: 'https://github.com/orgs/supabase/discussions/38200',
    verified: 'Substantive public support discussion · unresolved publicly'
  },
  {
    id: 'N20', kind: 'firsthand', tag: 'PROJECT DELETED',
    title: 'Deleting the project also removed its surrounding recovery path.',
    body: 'The developer deleted a project and then sought recovery while the connected application could no longer operate. The discussion records the support queue, not a self-service undo.',
    source: 'GitHub Discussions · Feb 28, 2025',
    href: 'https://github.com/orgs/supabase/discussions/33919',
    verified: 'Substantive public recovery discussion'
  },
  {
    id: 'N21', kind: 'firsthand', tag: 'DISPUTED DATA LOSS',
    title: 'Every table remained while every row was reportedly gone.',
    body: 'The user reported intact schemas with empty tables and no known destructive action. A community collaborator disputed platform deletion and directed the user to audit logs and support.',
    source: 'GitHub Discussions · Apr 6, 2025',
    href: 'https://github.com/orgs/supabase/discussions/34773',
    verified: 'Substantive but disputed report · no causal claim made'
  },
  {
    id: 'N22', kind: 'firsthand', tag: 'RESTORE ARTIFACT FAILED',
    title: 'Possessing the paused-project backup still did not produce a clean restore.',
    body: 'A user following the manual restore instructions encountered missing-file confusion, role conflicts, and extensive import errors while attempting to recover an old paused project.',
    source: 'GitHub Discussions · Jan 5, 2026',
    href: 'https://github.com/orgs/supabase/discussions/41710',
    verified: 'Public thread includes commands and restore errors'
  },
  {
    id: 'N23', kind: 'firsthand', tag: 'RESTORE BLOCKED',
    title: 'Replication subscriptions and slots prevented backup restoration.',
    body: 'The backup restore failed with a requirement to remove all subscriptions and replication slots first, turning a nominal backup into a technical recovery procedure.',
    source: 'GitHub Discussions · Mar 7, 2024',
    href: 'https://github.com/orgs/supabase/discussions/21830',
    verified: 'Public technical failure report and discussion'
  },
  {
    id: 'N24', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Americas project endpoints returned HTTP 500 errors.',
    body: 'Supabase declared a major incident affecting endpoints in Americas regions. The incident ran for about 85 minutes before being marked resolved.',
    source: 'Supabase Status · Jul 6, 2026',
    href: 'https://status.supabase.com/incidents/mkt5vw3qxh08',
    verified: 'Official major incident'
  },
  {
    id: 'N25', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'The Functions management API returned 500s for multiple operations.',
    body: 'Supabase reported a major Functions-management incident that interfered with multiple operations for roughly 92 minutes.',
    source: 'Supabase Status · Jul 1, 2026',
    href: 'https://status.supabase.com/incidents/273vdjyjmz0w',
    verified: 'Official major incident'
  },
  {
    id: 'N26', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Project status changes failed across multiple regions.',
    body: 'Supabase opened a major incident for failures changing project state across multiple regions—a direct risk to pause, unpause, restart, and recovery operations.',
    source: 'Supabase Status · Jun 30, 2026',
    href: 'https://status.supabase.com/incidents/3tx3nnmbwyh9',
    verified: 'Official major incident'
  },
  {
    id: 'N27', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'DNS failures disrupted project creation, restore, and pause.',
    body: 'An official major incident linked DNS-record creation failures to project creation, restoration, and pause operations for nearly four hours.',
    source: 'Supabase Status · Jun 18, 2026',
    href: 'https://status.supabase.com/incidents/72nly8q8062v',
    verified: 'Official major incident'
  },
  {
    id: 'N28', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Management API degradation affected payments and Studio.',
    body: 'Supabase reported major degradation in the Management API affecting both payment operations and Supabase Studio for about 99 minutes.',
    source: 'Supabase Status · Jun 17, 2026',
    href: 'https://status.supabase.com/incidents/qyc28n17gsmr',
    verified: 'Official major incident'
  },
  {
    id: 'N29', kind: 'official', tag: 'OFFICIAL · CRITICAL',
    title: 'Pause, restore, and backup operations failed together in Ohio.',
    body: 'Supabase classified errors affecting pause, restore, and backup operations in us-east-2 as critical. A redeployment restored operations after about 65 minutes.',
    source: 'Supabase Status · Jun 2, 2026',
    href: 'https://status.supabase.com/incidents/2psbh8l0sw0x',
    verified: 'Official critical incident'
  },
  {
    id: 'N30', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'A us-east availability-zone network incident lasted more than a day.',
    body: 'Supabase recorded major network-connectivity impact in us-east-1-az4 from May 8 into May 9—approximately 28 hours before resolution.',
    source: 'Supabase Status · May 8–9, 2026',
    href: 'https://status.supabase.com/incidents/x85ytwpgktjh',
    verified: 'Official major incident'
  },
  {
    id: 'N31', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'PostgREST requests returned 403 errors.',
    body: 'Supabase declared a major incident for 403 responses from PostgREST, affecting application data access for a little over two hours.',
    source: 'Supabase Status · Apr 28, 2026',
    href: 'https://status.supabase.com/incidents/rzwtq93tzd4f',
    verified: 'Official major incident'
  },
  {
    id: 'N32', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Projects became unreachable after restart.',
    body: 'Supabase reported that some projects could not be reached after a project restart. The major incident remained open for roughly nine hours.',
    source: 'Supabase Status · Apr 27, 2026',
    href: 'https://status.supabase.com/incidents/m9lv5ttn4bny',
    verified: 'Official major incident'
  },
  {
    id: 'N33', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Some projects were unavailable across multiple regions.',
    body: 'A separate major incident on the same day recorded multi-region project unavailability lasting more than six hours.',
    source: 'Supabase Status · Apr 27, 2026',
    href: 'https://status.supabase.com/incidents/m8fzj42277s1',
    verified: 'Official major incident'
  },
  {
    id: 'N34', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Project creation and configuration changes failed in two regions.',
    body: 'Supabase reported increased errors for project creation and configuration changes in US-East-2 and AP-Northeast-1.',
    source: 'Supabase Status · Apr 25, 2026',
    href: 'https://status.supabase.com/incidents/btgcd54tyh7k',
    verified: 'Official major incident'
  },
  {
    id: 'N35', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Newly created projects were unreachable.',
    body: 'Supabase opened a major incident after newly created projects could not be reached. The incident lasted more than three hours.',
    source: 'Supabase Status · Apr 24, 2026',
    href: 'https://status.supabase.com/incidents/1nzvd1b85lzn',
    verified: 'Official major incident'
  },
  {
    id: 'N36', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'HTTP endpoint errors continued for roughly thirteen hours.',
    body: 'Supabase classified increased HTTP endpoint errors as a major incident spanning Apr 17 into Apr 18 before resolution.',
    source: 'Supabase Status · Apr 17–18, 2026',
    href: 'https://status.supabase.com/incidents/kj2hm399j9cw',
    verified: 'Official major incident'
  },
  {
    id: 'N37', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Project creation failed in multiple APAC regions.',
    body: 'Supabase reported a major incident in which project creation failed in some APAC regions for approximately 72 minutes.',
    source: 'Supabase Status · Apr 12, 2026',
    href: 'https://status.supabase.com/incidents/mq5wbksl70j7',
    verified: 'Official major incident'
  },
  {
    id: 'N38', kind: 'official', tag: 'OFFICIAL · CRITICAL',
    title: 'Dashboard logs and Log Drains became inaccessible.',
    body: 'Supabase marked the loss of log access through both the dashboard and Log Drains as a critical incident, removing key diagnostic visibility during the event.',
    source: 'Supabase Status · Apr 8, 2026',
    href: 'https://status.supabase.com/incidents/xt9yl88y2wkk',
    verified: 'Official critical incident'
  },
  {
    id: 'N39', kind: 'official', tag: 'OFFICIAL · MAJOR',
    title: 'Plan upgrades returned increased errors.',
    body: 'Supabase declared a major incident after customers encountered elevated failures upgrading plans, an operationally important path during capacity or billing pressure.',
    source: 'Supabase Status · Apr 2, 2026',
    href: 'https://status.supabase.com/incidents/bcljwj8rwxks',
    verified: 'Official major incident'
  },
  {
    id: 'N40', kind: 'official', tag: 'OFFICIAL · RESTORE',
    title: 'Restore to New Project experienced an official incident.',
    body: 'Supabase tracked issues with Restore to New Project for nearly four hours—precisely the operation customers may depend upon during recovery.',
    source: 'Supabase Status · Jul 1, 2026',
    href: 'https://status.supabase.com/incidents/0fmgxxth7wd2',
    verified: 'Official restore incident'
  },
  {
    id: 'N41', kind: 'official', tag: 'OFFICIAL · LOGIN',
    title: 'SSO and email users could not log into the dashboard.',
    body: 'Supabase reported dashboard login problems for both SSO and email accounts. The incident lasted more than two hours.',
    source: 'Supabase Status · May 21, 2026',
    href: 'https://status.supabase.com/incidents/vd5bmmcdt5bf',
    verified: 'Official access incident'
  },
  {
    id: 'N42', kind: 'official', tag: 'OFFICIAL · HARDWARE',
    title: 'A hardware failure affected the us-east region.',
    body: 'Supabase recorded an infrastructure hardware failure in us-east. The incident remained open for approximately 110 minutes before resolution.',
    source: 'Supabase Status · Jun 17, 2026',
    href: 'https://status.supabase.com/incidents/dj3n11rv8q6h',
    verified: 'Official infrastructure incident'
  }
];
