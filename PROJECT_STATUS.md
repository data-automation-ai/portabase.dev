# Portabase — capability & evidence ledger

Status vocabulary: *scaffolded → implemented → provisioned → configured → deployed → verified → complete*. Never substitute one for another.

**Overall status: INCOMPLETE.** The engine can capture. The Cloud API can start Square checkout in code. A stranger still cannot place a real order on https://portabase.dev.

---

## Definition of Done — take a customer order

Who: a stranger customer (not an operator with the Netlify password).
Surface: **https://portabase.dev** (public, no site password).
Happy path:

1. Visit the site. Sign up with email or Google.
2. Land in `/app`, see plan picker — not unpaid ops with demo projects.
3. Choose **$17** (1 escape/24h) or **$27** (up to 3/day).
4. Complete Square checkout (card on file, $0 × 7-day trial).
5. Return to `/app` with **server-side** `hasAccess: true` (Square payment COMPLETED/CAPTURED including $0, or subscription PENDING/ACTIVE). UI gate is not enough.
6. Self-serve refund during trial closes Cloud.

Holes that make “we can take an order” a lie:

- Site password
- Subscribe using another product’s Square application
- Entitlement granted because the user came back from `/app?checkout=complete` with no Square proof
- Jobs API accepting any signed-in user
- Google “Access blocked” if we advertise Google to strangers
- Confirm/webhook unreachable because of the site password

**Not in this Definition of Done:** live `replay` into a blank project, full multi-GB Storage proof, SMS actually sending, Dropbox OAuth, a managed runner executing capture. Those remain product work. They are not required to *charge a card and grant Cloud access*.

---

## Customer-order rows

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
|---|---|---|---|---|---|---|---|---|
| Public site (no Netlify password) | Netlify site `794217cc-…` (`portabase-dev`) | ✅ site exists | ❌ `has_password=true`, `password_context=all` (probed 2026-08-23) | n/a | ❌ `/api/auth/config` returns Netlify password HTML | n/a | **BLOCKED** | Owner: disable visitor password. Webhooks cannot land while this is on. |
| Dedicated identity project | Supabase `eoiqvdmvgaurlecdzqkp` | ✅ | ✅ Netlify `SUPABASE_URL` production = this ref | ⚠️ OAuth app bundle not on prod | ❌ | n/a | **configured** | Manual `netlify deploy --prod` (no Git linkage) |
| Portabase Square application | Square | ❌ no `square-portabase-*` keys in `secrets-bundle` | ⚠️ Netlify `SQUARE_ACCESS_TOKEN` **dev** context **equals** `square-nysmassageexam-production-access-token`. Production value is redacted (`****`) so identity is unverified. | ❌ | ❌ | ❌ refuse-foreign-token guard is **implemented**, not live | **BLOCKED** | Owner: create Portabase Square app; store `square-portabase-production-access-token` + webhook signature; never reuse NYS. |
| Square catalog $17 / $27 trial plans | `ensureCloudPlanVariationId` | n/a | ⚠️ pins `SQUARE_CLOUD_PLAN_VARIATION_ID` optional; otherwise creates catalog | ❌ | ❌ | n/a | **implemented** | Needs Portabase Square token |
| `POST /api/cloud/subscribe` | `cloud-subscribe.mjs` | n/a | code yes | ❌ current prod behind password | ❌ | fail-closed on missing/foreign Square | **implemented** | Password + Portabase Square token |
| Confirm checkout verifies Square | `cloud-confirm-checkout.mjs` | n/a | ✅ CAPTURED-but-OPEN + $0 trial | ❌ | ❌ | ✅ does not grant on `checkout_pending` alone | **implemented** | Deploy + live card |
| Webhook | `square-webhook.mjs` | ❌ no Portabase webhook key in bundle; not in Netlify env | ❌ | ❌ | ❌ | HMAC verify exists; NYS webhook key refused if it matches | **implemented** | Password + Portabase webhook subscription to `https://portabase.dev/api/square/webhook` |
| Entitlement on jobs | `cloud-jobs.mjs` | n/a | ✅ HTTP 402 without `hasAccess` | ❌ | ❌ | ✅ | **implemented** | Deploy |
| Console paywall | `ConsoleApp.jsx` | n/a | ✅ signed-in ≠ entitled | ❌ | ❌ | UI only — server jobs already 402 | **implemented** | Deploy |
| Privacy + terms | `/privacy` `/terms` | n/a | ✅ | ❌ | ❌ | n/a | **implemented** | Needed to publish Google External app |
| Google sign-in (stranger) | see table below | ✅ client + consent | ⚠️ **Testing** | ❌ bundle | ⚠️ chooser only | ⚠️ | **implemented** | Deploy + publish-or-test-users. Email signup can take an order without Google publish. |

### Non-secret target identity

| Thing | Value |
|---|---|
| Supabase project (identity) | `eoiqvdmvgaurlecdzqkp` — "portabase.dev" |
| Supabase project (replay restore target — **not** identity) | `svltssnxzqsrxtbjgaex` — "portabase-replay-proof" |
| Shared portfolio project (**must not** be used for this product) | `ekklokrukxmqlahtonnc` — "DataAutomation" |
| GCP project (Portabase consent screen) | `portabase-dev` / `495102144848` |
| Netlify site id | `794217cc-42ab-4a9f-81da-06a661403573` |
| Deploy mechanism | **No Git linkage** — `netlify deploy --prod`. Merging to `main` ships nothing. |
| Square in secrets-bundle | `square-location-id` (shared) + **`square-nysmassageexam-*` only**. No `square-portabase-*`. |
| Netlify Square env | `SQUARE_ENV=production`. Dev access token **is** the NYS token (byte-equal). Production token redacted by API. |
| Publishable key (public) | `sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL` |

---

## Definition of Done (Google sign-in)

Agreed finish line for this capability:

- A stranger visits `https://portabase.dev/login`, clicks **Continue with
  Google**, picks any Google account, and lands in the Cloud console at `/app`
  with a real Supabase session.
- The session is issued by **Portabase's own Supabase project**
  (`eoiqvdmvgaurlecdzqkp`), not the shared portfolio project.
- Sign-out clears the session and `/app` is denied afterward.
- The popup-blocked path still completes via full-page redirect.

Not done until every row below reads **verified**. Identity is not entitlement.

---

## Google capability rows

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
|---|---|---|---|---|---|---|---|---|
| Dedicated Supabase project | Supabase org `capece` (Pro) | ✅ `eoiqvdmvgaurlecdzqkp`, us-east-1, ACTIVE_HEALTHY, created 2026-08-20 | ✅ Google provider + site_url + allow list | n/a | ✅ | n/a | **configured** | — |
| GCP project + consent screen | gcloud + console | ✅ `portabase-dev` / `495102144848` | ✅ App name `Portabase`, **External**, support+contact `rfiddomains@gmail.com`, home page set | n/a | ✅ consent screen renders as `portabase.dev` | n/a | **verified** | Publishing status is **Testing** |
| Consent screen logo | `scripts/make-app-icon.py` | ✅ `public/icons/portabase-consent-120.png` | ❌ **not uploaded** | ❌ | ✅ 120x120, 6.3 KB, verified by test | n/a | **BLOCKED** | File input is hidden from the a11y tree; JS reveal blocked. Manual: Branding → Browse |
| Google OAuth client | Google Cloud Console (browser-automated) | ✅ `portabase-web`, client id `495102144848-jvd6gi5nk948t0v3l527n2hpldcr56bd` | ✅ 4 JS origins + 5 redirect URIs | n/a | ✅ account chooser renders "to continue to portabase.dev"; unregistered-URI control correctly returns `Error 400: redirect_uri_mismatch` | ✅ secret never in bundle/repo | **verified** | — |
| Google client secrets in `secrets-bundle` | AWS `899867382621` | ✅ `portabase-google-oauth-client-id` / `-client-secret` / `-updated-at` | ✅ | n/a | ✅ round-trip read back byte-exact; 293→296 keys, no key lost | ✅ | **verified** | — |
| Supabase Auth → Google provider | Supabase Management API | n/a | ✅ enabled; `site_url=https://portabase.dev`; 4-entry redirect allow list | n/a | ✅ read back: `external_google_client_id` matches the client the app sends (the `aud` check) | ✅ secret set, never echoed | **verified** | — |
| id_token sign-in flow (browser) | `src/lib/google-gis-auth.js` | n/a | n/a | ❌ not merged to `main` | ❌ | ⚠️ partial | **implemented** | Live proof requires the deployed bundle |
| Single GoTrue client / no URL-handler race | `src/lib/supabase-auth.js` | n/a | ✅ `detectSessionInUrl: false` | ❌ | ❌ | ✅ guarded by test | **implemented** | — |
| Product isolation guard | `tests/google-oauth-isolation.test.mjs` | n/a | ✅ | ❌ | ✅ 11/11 pass, **mutation-tested** (6/6 seeded regressions caught), runs in CI via `.github/workflows/ci.yml:23` | ✅ | **verified (CI-level)** | — |
| Netlify env vars | Netlify site `794217cc-…` (`portabase-dev`) | n/a | ✅ all 5 set across all 4 contexts | ❌ not yet deployed | ✅ read back; **0** occurrences of the shared ref remain | n/a | **configured** | Takes effect only on next deploy |

---

## Why the OAuth client could not be created from the CLI

Tested, not assumed (2026-08-20). **Correction to an earlier claim in this file:**
gcloud *does* ship OAuth client commands — `gcloud iam oauth-clients create` and
`gcloud iap oauth-clients create`. Neither creates a "Sign in with Google" web
client, which is the trap: a command can succeed and hand back a client id that
cannot do this job.

- `iam oauth-clients` is **workforce identity federation** — scope
  `cloud-platform`, for reaching Google Cloud resources on behalf of
  workforce-pool users. Supabase's Google provider would reject it.
  `gcloud iam oauth-clients list` returned **0 items** across every project in
  this account, so no such client was ever created here.
- `iap oauth-clients` is **IAP-locked**: redirect URIs are immutable by design,
  and the IAP OAuth Admin APIs were permanently shut down **2026-03-19**.
- `gcloud` 550.0.0 is installed and authenticated as `rfiddomains@gmail.com`.
- The only programmatic path to an OAuth brand/client is the IAP API
  (`iap.googleapis.com` → `projects.brands`). Calling it returns:
  `400 INVALID_ARGUMENT — "Project must belong to an organization."`
- `gcloud organizations list` returns **0 items** — this is a consumer Gmail
  account with no Workspace organization, so no brand can be created via API.
- Even with an organization, `brands.create` produces **internal** (org-only)
  brands and **IAP-typed** clients. Portabase needs an **external** brand so any
  Google account can sign in, and a general **Web application** client. Google
  exposes no API for either.
- `gcloud alpha` is not installed and cannot be added without administrator
  rights on `C:\Program Files (x86)\Google\Cloud SDK`. This is moot — the alpha
  commands wrap the same org-restricted IAP API.

**Conclusion:** the consent screen and Web application client are console-only —
confirmed by Google's own [Manage OAuth Clients](https://support.google.com/cloud/answer/15549257)
page, which documents creation solely as a console flow. A Google platform
limitation, not a tooling gap. Everything downstream *is* automatable, and was
automated. The console steps were completed by browser automation instead.

## Remaining holes, in order (customer order)

1. **Disable the Netlify visitor password** on `portabase-dev` (`password_context=all`). Until that click, no stranger and no Square webhook can reach the site. Confirm before I flip it — it makes the site public.
2. **Provision a Portabase Square application** (not NYS Massage Exam). Put in `secrets-bundle`:
   - `square-portabase-application-id`
   - `square-portabase-production-access-token`
   - `square-portabase-production-application-secret`
   - `square-portabase-webhook-signature-key`
   Then set Netlify production `SQUARE_ACCESS_TOKEN` / webhook key to those values. Dev context today is the NYS token; the code now refuses that match when the bundle is readable.
3. **Deploy this bundle** (`netlify deploy --prod`). No Git linkage.
4. Register Square webhook `https://portabase.dev/api/square/webhook`.
5. **Google:** deploy is required even for email; publishing to Production (or listing test users) is required for stranger Google. Privacy and terms routes now exist in code. Logo upload still manual. Testing vs Production tradeoff unchanged (logo triggers brand verification).
6. **Live proof:** one real (or Square sandbox) checkout, then `/api/cloud/me` shows `hasAccess: true`, jobs no longer 402, refund during trial closes access.

### Publishing tradeoff (a real decision, not a detail)

Google's Branding page states: *"After you upload a logo, you will need to
submit your app for verification unless the app... has a publishing status of
'Testing'."* Portabase requests only non-sensitive scopes (`openid`, `email`,
`profile`), so it can normally publish to Production **without** review — but
**uploading a custom logo triggers brand verification**, which can take days to
weeks, during which the consent screen shows a default.

So: logo **or** fast launch. Removing the logo before publishing is trivial if
speed matters more.

### Migration note — accounts do not come along

Netlify previously pointed at the shared project `ekklokrukxmqlahtonnc`. Any
Portabase Cloud account that already exists there lives in *that* project's
`auth.users` and will **not** exist on `eoiqvdmvgaurlecdzqkp` after cutover.
Pre-launch this is expected to be empty, but it was not verified — confirm
before deploying if any real signups may have occurred.

## Live proof checklist

- [x] **Google account chooser appears, not "Access blocked"** — verified
      2026-08-20 by driving the authorize endpoint directly: it renders
      "Choose an account / to continue to **portabase.dev**". A control request
      with an unregistered redirect URI correctly failed with
      `Error 400: redirect_uri_mismatch`, so the check discriminates.
      (An earlier `curl` probe of the same thing was **discarded** — its
      control passed too, meaning it proved nothing.)
- [ ] Click Google on the deployed `https://portabase.dev/login` (needs the new bundle **and** the site password off)
- [ ] Returns to the app with a **valid session** (inspect the user object, not just the UI)
- [ ] `/app` (protected route) loads
- [ ] Sign out clears the session
- [ ] After sign-out, `/app` is denied
- [ ] Popup-blocked path: block popups, confirm the redirect fallback completes
- [ ] Bundle scan: correct client id present, no client secret, no other product's id
- [ ] Square checkout for `cloud-17` returns a payment link on the **Portabase** application
- [ ] Confirm after redirect does **not** grant if Square was skipped
- [ ] After a real card-on-file trial, `hasAccess` is true and `POST /api/cloud/jobs` is not 402
- [ ] Trial self-refund closes access

**Regression rows for the `detectSessionInUrl: false` flip.** Email confirmation
and password-recovery links also land on `/auth/callback`. Under PKCE they
arrive as `?code=` and `completeOAuthCallback()` handles them — but if the new
project's email templates emit implicit-flow fragments (`#access_token=`), the
handler that used to catch those is now off and `completeOAuthCallback()` will
throw "No session found after auth redirect." These must be proven, not assumed:

- [ ] Email signup confirmation link completes and lands in `/app`
- [ ] Password recovery link completes and allows a password change

Identity is not entitlement — a signed-in user is not a paying one. Cloud
membership must still be checked server-side.

---

## Verified so far (2026-08-23)

- Live `https://portabase.dev/api/auth/config` is **not** the Cloud API — it is Netlify's password gate (`has_password=true`).
- `secrets-bundle` has **no** `square-portabase-*` keys. Square keys present: `square-location-id`, `m-square-validation-key`, `square-nysmassageexam-*`.
- Netlify `SQUARE_ACCESS_TOKEN` **dev** context is byte-equal to `square-nysmassageexam-production-access-token`. Production value is API-redacted.
- Confirm-checkout previously granted `trialing` without talking to Square. That is fixed in this session's code (not deployed).
- Jobs previously accepted any verified JWT. That is fixed in this session's code (not deployed).

## Verified so far (2026-08-20) — Google scaffolding

- Build passes: `npm run build` → 746.50 kB bundle, no errors.
- Full suite passes: `npm test` → **109/109**, including the 11 new isolation tests.
- Isolation guard **mutation-tested**, 6 seeded regressions, all caught:
  shared project ref reintroduced; client id hardcoded as a literal;
  `detectSessionInUrl` flipped back to true; a foreign product domain leaked in;
  the purpose phrase dropped from the root document; a wrong-size consent logo
  substituted. Baseline restored to 11/11 after each.
- Built bundle contains **no** `GOCSPX-` client secret and **no** foreign
  product domain in auth code. (`ekklokrukxmqlahtonnc`, `svltssnxzqsrxtbjgaex`,
  and `musicsupplies.*` do appear in the bundle — they are console *demo data*
  naming backup **sources**, which is this product's subject matter, not an
  auth binding.)

## Not verified

- Nothing has been tested against a live Google account on the deployed site.
- Email signup confirmation and password recovery have **not** been re-tested
  since `detectSessionInUrl` was set to false.
- No Portabase Square payment link has been created with a Portabase-scoped token.
- Nothing from this order-path session is deployed. Work is local on
  `agent-checkpoints/claude/5075c12e-google-oauth` plus uncommitted order-path
  files. Pre-existing dirty files in this tree (proof-case wall, replay docs,
  engine edits) are **not** this session and must not be absorbed into an
  order-path commit.
