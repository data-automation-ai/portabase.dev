# PortaBase.dev — documented Supabase nightmare incidents

Research snapshot: 2026-07-12

This is the continuously maintained publication set used by the PortaBase landing page. It contains real, sourced firsthand/public-support cases and official Supabase incidents. The homepage intentionally publishes a curated selection rather than advertising a fixed total.

## Admission standard

An item counts only when it has all of the following:

- a publicly reachable source;
- a concrete event that actually occurred;
- a specific operational consequence such as account loss, database unavailability, failed restore, project lockout, data loss, or a confirmed service incident;
- enough source content to distinguish it from a joke, meme, hypothetical, or unsupported one-line claim; and
- a visible qualification when the cause is disputed, corrected, customer-caused, or unresolved.

The following are **not admitted as incidents**: policy pages, documentation gaps by themselves, feature requests, product evaluations, generic backup questions, market-demand posts, jokes, memes, or hypothetical warnings.

## Curated incident index

| ID | Evidence | Actual incident | Source |
| --- | --- | --- | --- |
| N01 | Firsthand support thread | Paid Pro account banned; database/API unavailable; no response after 48 hours | [AnswerOverflow, Oct 25 2025](https://www.answeroverflow.com/m/1431525602867023992) |
| N02 | Firsthand support thread | GitHub login returned `User is banned`, including on the support path | [AnswerOverflow, Nov 12 2025](https://www.answeroverflow.com/m/1438177383642566719) |
| N03 | Firsthand support thread | Company-email account unexpectedly banned; no public resolution | [AnswerOverflow, May 12 2026](https://www.answeroverflow.com/m/1503591699413340340) |
| N04 | Firsthand support thread | Production database unreachable in recovery mode for 24 hours | [AnswerOverflow, Sep 7 2025](https://www.answeroverflow.com/m/1414123910621958174) |
| N05 | Firsthand support thread | Restart/transfer/pause sequence left project dashboard and tables inaccessible | [AnswerOverflow, Apr 4 2026](https://www.answeroverflow.com/m/1489915521368326164) |
| N06 | Firsthand + response | Billing dispute froze projects; Supabase described chargeback pause and later unblocked account | [Reddit, Apr 30 2025](https://www.reddit.com/r/Supabase/comments/1kbj0sh/) |
| N07 | Firsthand + quoted support | Deleted branch remained billable after a stuck `GOING_DOWN` resource | [Reddit, Jan 19 2026](https://www.reddit.com/r/Supabase/comments/1qgyx97/) |
| N08 | Firsthand | Pro production project repeatedly offline for more than two days after upgrade | [Reddit, Aug 17 2025](https://www.reddit.com/r/Supabase/comments/1msrwza/) |
| N09 | Firsthand | Branching/upgrade problems reportedly stalled work for roughly ten days | [Reddit, Oct 14 2025](https://www.reddit.com/r/Supabase/comments/1o6aayg/) |
| N10 | Firsthand, resolved | Changed GitHub identity made all projects appear unavailable | [Reddit, Jan 21 2025](https://www.reddit.com/r/Supabase/comments/1i6jzuj/) |
| N11 | Firsthand + official incident | Auth and data access failed across customer projects | [Reddit, Nov 24 2025](https://www.reddit.com/r/Supabase/comments/1p5cs5w/) |
| N12 | Firsthand | Pausing during an I/O problem left project stuck and inaccessible | [Reddit, Apr 15 2026](https://www.reddit.com/r/Supabase/comments/1smif95/) |
| N13 | Firsthand, reproducible | Connection limit set to zero locked out API, dashboard, and repair path | [Reddit, Mar 7 2026](https://www.reddit.com/r/Supabase/comments/1rn42ys/) |
| N14 | Firsthand | Egress restriction arrived before user could obtain emergency backup | [Reddit, Mar 5 2026](https://www.reddit.com/r/Supabase/comments/1rle3pn/) |
| N15 | Firsthand, corrected | Compromised cofounder account deleted six months of project work | [Reddit, Apr 7 2025](https://www.reddit.com/r/Supabase/comments/1jt9kix/) |
| N16 | Firsthand, mixed outcomes | Resumed paused project reportedly returned without expected data | [Reddit, Dec 28 2022](https://www.reddit.com/r/Supabase/comments/zwx378/) |
| N17 | Firsthand, support exception | Entire table deleted without customer backup; support restored it once | [Reddit, Jun 4 2024](https://www.reddit.com/r/Supabase/comments/1d7qyyz/) |
| N18 | Firsthand | Expired project recovery became a confusing manual backup-file migration | [Reddit, Oct 13 2024](https://www.reddit.com/r/Supabase/comments/1g2y2k4/) |
| N19 | Public support discussion | Service restriction remained after reported overage was cleared | [GitHub #38200, Aug 25 2025](https://github.com/orgs/supabase/discussions/38200) |
| N20 | Public support discussion | Deleted project had no self-service undo while application remained disconnected | [GitHub #33919, Feb 28 2025](https://github.com/orgs/supabase/discussions/33919) |
| N21 | Public, explicitly disputed | Schemas remained while every row reportedly disappeared | [GitHub #34773, Apr 6 2025](https://github.com/orgs/supabase/discussions/34773) |
| N22 | Public restore transcript | Paused-project backup produced role conflicts and extensive import errors | [GitHub #41710, Jan 5 2026](https://github.com/orgs/supabase/discussions/41710) |
| N23 | Public technical failure | Replication subscriptions/slots blocked backup restoration | [GitHub #21830, Mar 7 2024](https://github.com/orgs/supabase/discussions/21830) |
| N24 | Official major incident | Americas project endpoints returned HTTP 500 | [Supabase Status, Jul 6 2026](https://status.supabase.com/incidents/mkt5vw3qxh08) |
| N25 | Official major incident | Functions management API returned 500s for multiple operations | [Supabase Status, Jul 1 2026](https://status.supabase.com/incidents/273vdjyjmz0w) |
| N26 | Official major incident | Project status changes failed across multiple regions | [Supabase Status, Jun 30 2026](https://status.supabase.com/incidents/3tx3nnmbwyh9) |
| N27 | Official major incident | DNS failures disrupted project creation, restore, and pause | [Supabase Status, Jun 18 2026](https://status.supabase.com/incidents/72nly8q8062v) |
| N28 | Official major incident | Management API degradation affected payments and Studio | [Supabase Status, Jun 17 2026](https://status.supabase.com/incidents/qyc28n17gsmr) |
| N29 | Official critical incident | Pause, restore, and backup operations failed together in Ohio | [Supabase Status, Jun 2 2026](https://status.supabase.com/incidents/2psbh8l0sw0x) |
| N30 | Official major incident | us-east availability-zone network impact lasted about 28 hours | [Supabase Status, May 8–9 2026](https://status.supabase.com/incidents/x85ytwpgktjh) |
| N31 | Official major incident | PostgREST requests returned 403 errors | [Supabase Status, Apr 28 2026](https://status.supabase.com/incidents/rzwtq93tzd4f) |
| N32 | Official major incident | Projects became unreachable following restart | [Supabase Status, Apr 27 2026](https://status.supabase.com/incidents/m9lv5ttn4bny) |
| N33 | Official major incident | Projects unavailable across multiple regions | [Supabase Status, Apr 27 2026](https://status.supabase.com/incidents/m8fzj42277s1) |
| N34 | Official major incident | Project creation and configuration changes failed in two regions | [Supabase Status, Apr 25 2026](https://status.supabase.com/incidents/btgcd54tyh7k) |
| N35 | Official major incident | Newly created projects were unreachable | [Supabase Status, Apr 24 2026](https://status.supabase.com/incidents/1nzvd1b85lzn) |
| N36 | Official major incident | HTTP endpoint errors continued for roughly thirteen hours | [Supabase Status, Apr 17–18 2026](https://status.supabase.com/incidents/kj2hm399j9cw) |
| N37 | Official major incident | Project creation failed in multiple APAC regions | [Supabase Status, Apr 12 2026](https://status.supabase.com/incidents/mq5wbksl70j7) |
| N38 | Official critical incident | Dashboard logs and Log Drains became inaccessible | [Supabase Status, Apr 8 2026](https://status.supabase.com/incidents/xt9yl88y2wkk) |
| N39 | Official major incident | Plan upgrades returned increased errors | [Supabase Status, Apr 2 2026](https://status.supabase.com/incidents/bcljwj8rwxks) |
| N40 | Official restore incident | Restore to New Project experienced an outage | [Supabase Status, Jul 1 2026](https://status.supabase.com/incidents/0fmgxxth7wd2) |
| N41 | Official access incident | SSO and email users could not log into the dashboard | [Supabase Status, May 21 2026](https://status.supabase.com/incidents/vd5bmmcdt5bf) |
| N42 | Official infrastructure incident | Hardware failure affected the us-east region | [Supabase Status, Jun 17 2026](https://status.supabase.com/incidents/dj3n11rv8q6h) |

## Publication safeguards

- Firsthand reports are described as reports, not independent findings of fault.
- N15 must retain the account-takeover correction.
- N16 must retain the mixed-outcome context.
- N21 must remain labeled disputed.
- Screenshots must show the source identity/date and any material correction or response.
- Email addresses, project references, ticket numbers, and unrelated browser content must be redacted.
- Recreated quote cards do not count as source screenshots.

The canonical landing-page data is in `src/data/nightmares.js`. Automated tests enforce 42 unique IDs/URLs and the 23-firsthand/19-official split.
