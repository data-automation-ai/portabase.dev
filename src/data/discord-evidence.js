// Firsthand Discord reports, reviewed against the supplied screenshots.
// These are reports by users, not independently verified findings of cause.
export const discordEvidence = [
  {
    id: 'D14', kind: 'firsthand', date: '2026-10-26', tag: 'ACCOUNT BANNED',
    title: 'A disputed charge was followed by an account ban affecting client projects.',
    body: 'A developer said a client reversed a card dispute after the account was banned. The developer reported that about eight live client projects were down and had contacted support.',
    source: 'Discord · Oct 26, 2026', href: 'https://discord.com/channels/839993398554656828/1564317123352731658/1564317123352731658',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D20', kind: 'firsthand', date: '2026-10-26', tag: 'PRODUCTION PROJECTS PAUSING',
    title: 'Production projects showed “Project is pausing” for more than a week.',
    body: 'The poster said several production projects had shown the pausing state for over seven days, that they had not authorized it, and that their support email had not received a reply.',
    source: 'Discord · Oct 26, 2026', href: 'https://discord.com/channels/839993398554656828/1564292594744295535/1564292594744295535',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D25', kind: 'firsthand', date: '2026-10-23', tag: 'DASHBOARD ACCESS LOST',
    title: 'A GitHub login opened an empty dashboard instead of the existing organization.',
    body: 'The poster said their existing organization contained three projects but neither GitHub sign-in nor a separate email login showed it. A community moderator suggested checking the account and other sign-in paths.',
    source: 'Discord · Oct 23, 2026', href: 'https://discord.com/channels/839993398554656828/1563363817235156992/1563363817235156992',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D01', kind: 'firsthand', date: '2026-10-23', tag: 'IDENTITY LOCKOUT',
    title: 'A suspended GitHub login blocked access to the Supabase dashboard.',
    body: 'The poster said their account supported only GitHub sign-in and password reset could not be used. A community moderator suggested an alternate sign-in using the same email; the poster later thanked them.',
    source: 'Discord · Oct 23, 2026', href: 'https://discord.com/channels/839993398554656828/1563211722528137357/1563211722528137357',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D24', kind: 'firsthand', date: '2026-10-23', tag: 'DATABASE EMPTY AFTER UNPAUSE',
    title: 'A customer reported an empty production database after unpausing.',
    body: 'The poster said the app was down and sought an older backup. They said the available backup history covered only one week; the thread does not establish the cause or final outcome.',
    source: 'Discord · Oct 23, 2026', href: 'https://discord.com/channels/839993398554656828/1563147329953996840/1563149172234788915',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D18', kind: 'firsthand', date: '2026-10-21', tag: 'STORAGE BACKUP FAILED',
    title: 'A nightly Storage backup could list objects but could not download them.',
    body: 'The poster reported that downloads through the S3-compatible endpoint failed despite successful listings, while downloads through the dashboard still worked. The cause was not established in the captured discussion.',
    source: 'Discord · Oct 21, 2026', href: 'https://discord.com/channels/839993398554656828/1562640067850403921/1562640067850403921',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D19', kind: 'firsthand', date: '2026-10-21', tag: 'STORAGE EXPORT BLOCKED',
    title: 'A restricted project could not export its Storage files for migration.',
    body: 'The poster said cached egress had exceeded the allowance and the old project’s Storage API returned HTTP 402. They asked how to recover files needed for a migration.',
    source: 'Discord · Oct 21, 2026', href: 'https://discord.com/channels/839993398554656828/1562536839720472716/1562536839720472716',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D02', kind: 'firsthand', date: '2026-10-21', tag: 'IDENTITY LOCKOUT',
    title: 'A GitHub suspension left a user seeking another way into Supabase.',
    body: 'The poster said their GitHub account was suspended, their Supabase projects were affected by quotas, and they needed to switch to email login. A community member pointed them to another discussion.',
    source: 'Discord · Oct 21, 2026', href: 'https://discord.com/channels/839993398554656828/1562428351459754075/1562428351459754075',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D21', kind: 'firsthand', date: '2026-10-20', tag: 'PRODUCTION APP UNAVAILABLE',
    title: 'A production app was inaccessible while its project was pausing.',
    body: 'The customer said the project remained in a pausing state and the production app was inaccessible. They later said a payment had been late because of a bank issue.',
    source: 'Discord · Oct 20, 2026', href: 'https://discord.com/channels/839993398554656828/1562171784575590551/1562171784575590551',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D22', kind: 'firsthand', date: '2026-10-19', tag: 'RESTORE BLOCKED',
    title: 'A production project remained in restarting state for 28 hours.',
    body: 'The poster reported unhealthy services and said restart, restore and a restore-to-new-project path were blocked. They said backups existed and requested help restoring one into another project.',
    source: 'Discord · Oct 19, 2026', href: 'https://discord.com/channels/839993398554656828/1561799217251491851/1561799217251491851',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D03', kind: 'firsthand', date: '2026-10-16', tag: 'IDENTITY LOCKOUT',
    title: 'A locked-out user worried about a paused project nearing its restore window.',
    body: 'The poster said their GitHub sign-in was suspended and a support verification link had expired. They were concerned about a paused project approaching its stated restore window; the screenshot does not show data deletion.',
    source: 'Discord · Oct 16, 2026', href: 'https://discord.com/channels/839993398554656828/1560705246462873610/1560705246462873610',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D04', kind: 'firsthand', date: '2026-10-15', tag: 'RESTORE STUCK',
    title: 'Paying customers discussed a stuck restore and delayed support.',
    body: 'In a discussion about a project stuck on pause, a customer reported more than 70 hours without a support response. A moderator said the infrastructure team would need to handle the stuck restore.',
    source: 'Discord · Oct 15, 2026', href: 'https://discord.com/channels/839993398554656828/1560366276335902740/1560392563272192123',
    verified: 'Firsthand discussion · Discord sign-in and server access may be required'
  },
  {
    id: 'D15', kind: 'firsthand', date: '2026-10-13', tag: 'ACCOUNT BANNED',
    title: 'An agency account was banned while client projects were down.',
    body: 'The poster said the account remained locked after failed invoices were paid and reported 20 agency client projects down. They asked whether backup files could be provided; the reason for the ban is not established by the thread.',
    source: 'Discord · Oct 13, 2026', href: 'https://discord.com/channels/839993398554656828/1559538480458104912/1559538480458104912',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D05', kind: 'firsthand', date: '2026-10-11', tag: 'IDENTITY LOCKOUT',
    title: 'A GitHub suspension blocked dashboard access ahead of a launch.',
    body: 'The poster said their production projects were still running but they could not reach the dashboard. After a community suggestion to use another sign-in method with the same email, they reported that it worked.',
    source: 'Discord · Oct 11, 2026', href: 'https://discord.com/channels/839993398554656828/1558797040022986852/1558797040022986852',
    verified: 'Firsthand report · poster reported regaining access · Discord access may be required'
  },
  {
    id: 'D06', kind: 'firsthand', date: '2026-10-10', tag: 'IDENTITY LOCKOUT',
    title: 'A GitHub-only user could not sign in after a GitHub suspension.',
    body: 'The poster said they had emailed support while locked out of the dashboard. A community member linked another discussion, and the poster subsequently said the suggestion worked.',
    source: 'Discord · Oct 10, 2026', href: 'https://discord.com/channels/839993398554656828/1558428195659718757/1558428195659718757',
    verified: 'Firsthand report · poster reported regaining access · Discord access may be required'
  },
  {
    id: 'D07', kind: 'firsthand', date: '2026-10-08', tag: 'PAUSED PROJECT AND LOCKOUT',
    title: 'A paused project and a suspended GitHub login blocked access to data.',
    body: 'The poster said the project was paused for inactivity while their linked GitHub account was suspended, leaving both dashboard access and direct database access unavailable. They asked about obtaining a database dump or unpausing.',
    source: 'Discord · Oct 8, 2026', href: 'https://discord.com/channels/839993398554656828/1557801161346646116/1557801161346646116',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D08', kind: 'firsthand', date: '2026-10-05', tag: 'PAID PROJECT LOCKOUT',
    title: 'A paid-project owner lost dashboard access after a GitHub suspension.',
    body: 'The poster said they could not manage a live paid project after their GitHub account was suspended. The next day, they reported regaining account access and restoring the ongoing projects after following a community suggestion.',
    source: 'Discord · Oct 5, 2026', href: 'https://discord.com/channels/839993398554656828/1556732853407191150/1556732853407191150',
    verified: 'Firsthand report · poster reported recovery · Discord access may be required'
  },
  {
    id: 'D17', kind: 'firsthand', date: '2026-10-02', tag: 'IDENTITY LOCKOUT',
    title: 'A GitHub ban left several Supabase projects inaccessible to their owner.',
    body: 'The poster said they could no longer access important database data in several projects after their GitHub sign-in was banned. A community moderator suggested an alternate sign-in method.',
    source: 'Discord · Oct 2, 2026', href: 'https://discord.com/channels/839993398554656828/1555585120327565362/1555585120327565362',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D11', kind: 'firsthand', date: '2026-09-19', tag: 'STORAGE ACCESS LOST',
    title: 'A GitHub suspension blocked access to project Storage files.',
    body: 'The poster said they could not access the dashboard or Storage files and asked about changing the login method or exporting the files. Another participant noted that existing deployment credentials could provide an alternate path.',
    source: 'Discord · Sep 19, 2026', href: 'https://discord.com/channels/839993398554656828/1550759266132959282/1550759266132959282',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D10', kind: 'firsthand', date: '2026-09-09', tag: 'PAUSED PROJECT AND LOCKOUT',
    title: 'An owner could not reach a paused production project after GitHub suspension.',
    body: 'The poster said the GitHub suspension prevented dashboard access and that their paused production project was scheduled for deletion in roughly 85 days. The screenshot does not show that deletion occurred.',
    source: 'Discord · Sep 9, 2026', href: 'https://discord.com/channels/839993398554656828/1547336892960350288/1547336892960350288',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D12', kind: 'firsthand', date: '2026-09-07', tag: 'IDENTITY LOCKOUT',
    title: 'A suspended GitHub account blocked access to a project database.',
    body: 'The poster said the dashboard was tied to a suspended GitHub login and that they had no other way to access important project data. They asked for help recovering account access.',
    source: 'Discord · Sep 7, 2026', href: 'https://discord.com/channels/839993398554656828/1546540365417414767/1546540365417414767',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D09', kind: 'firsthand', date: '2026-09-07', tag: 'BACKUP DOWNLOAD BLOCKED',
    title: 'A customer reported a failed restore and a blocked backup download.',
    body: 'The customer said an unpaid invoice had been paid within minutes, but the suspended production project remained inaccessible after restore failures. They said the backup download was blocked while the project was inactive.',
    source: 'Discord · Sep 7, 2026', href: 'https://discord.com/channels/839993398554656828/1546425191934992404/1546425191934992404',
    verified: 'Firsthand report · Discord sign-in and server access may be required'
  },
  {
    id: 'D13', kind: 'firsthand', date: '2026-09-02', tag: 'PROJECT RESTRICTED',
    title: 'A project remained restricted after its owner addressed an egress issue.',
    body: 'The poster said they had stopped the egress and that the grace period was shortened before the project was suspended. A moderator noted that the reported usage was far above the allowance; the cause and outcome are not independently established.',
    source: 'Discord · Sep 2, 2026', href: 'https://discord.com/channels/839993398554656828/1544849132349562930/1544850970654150687',
    verified: 'Firsthand discussion · Discord sign-in and server access may be required'
  },
];
