# Portabase — capability & evidence ledger

Scope of this file: **Google sign-in for Portabase Cloud identity.** Other
capabilities (capture, restore, replay, Square billing) are tracked in
`PROJECT.md` and `docs/HANDOFF.md`.

Status vocabulary is the portfolio one: *scaffolded → implemented → provisioned
→ configured → deployed → verified → complete*. Never substitute one for
another.

**Overall status: INCOMPLETE — provisioning and configuration are done and
verified; blocked on deploying the app bundle and running the live sign-in proof.**

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

Not done until every row below reads **verified**.

---

## Capability rows

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
|---|---|---|---|---|---|---|---|---|
| Dedicated Supabase project | Supabase org `capece` (Pro) | ✅ `eoiqvdmvgaurlecdzqkp`, us-east-1, ACTIVE_HEALTHY, created 2026-08-20 | ✅ Google provider + site_url + allow list | n/a | ✅ | n/a | **configured** | — |
| GCP project + consent screen | gcloud + console | ✅ `portabase-dev` / `495102144848` | ✅ App name `Portabase`, **External**, support+contact `rfiddomains@gmail.com`, home page set | n/a | ✅ consent screen renders as `portabase.dev` | n/a | **verified** | Publishing status is **Testing** |
| Consent screen logo | `scripts/make-app-icon.py` | ✅ `public/icons/portabase-consent-120.png` | ❌ **not uploaded** | ❌ | ✅ 120x120, 6.3 KB, verified by test | n/a | **BLOCKED** | File input is hidden from the a11y tree; JS reveal blocked. Manual: Branding → Browse |
| Google OAuth client | Google Cloud Console (browser-automated) | ✅ `portabase-web`, client id `495102144848-jvd6gi5nk948t0v3l527n2hpldcr56bd` | ✅ 4 JS origins + 5 redirect URIs | n/a | ✅ account chooser renders "to continue to portabase.dev"; unregistered-URI control correctly returns `Error 400: redirect_uri_mismatch` | ✅ secret never in bundle/repo | **verified** | — |
| Google client secrets in `secrets-bundle` | AWS `899867382621` | ✅ `portabase-google-oauth-client-id` / `-client-secret` / `-updated-at` | ✅ | n/a | ✅ round-trip read back byte-exact; 293→296 keys, no key lost | ✅ | **verified** | — |
| Supabase Auth → Google provider | Supabase Management API | n/a | ✅ enabled; `site_url=https://portabase.dev`; 4-entry redirect allow list | n/a | ✅ read back: `external_google_client_id` matches the client the app sends (the `aud` check) | ✅ secret set, never echoed | **verified** | — |
| id_token sign-in flow (browser) | `src/lib/google-gis-auth.js` | n/a | n/a | ❌ not merged to `main` | ❌ | ⚠️ partial | **implemented** | Live proof requires the OAuth client |
| Single GoTrue client / no URL-handler race | `src/lib/supabase-auth.js` | n/a | ✅ `detectSessionInUrl: false` | ❌ | ❌ | ✅ guarded by test | **implemented** | — |
| Product isolation guard | `tests/google-oauth-isolation.test.mjs` | n/a | ✅ | ❌ | ✅ 11/11 pass, **mutation-tested** (6/6 seeded regressions caught), runs in CI via `.github/workflows/ci.yml:23` | ✅ | **verified (CI-level)** | — |
| Netlify env vars | Netlify site `794217cc-…` (`portabase-dev`) | n/a | ✅ all 5 set across all 4 contexts | ❌ not yet deployed | ✅ read back; **0** occurrences of the shared ref remain | n/a | **configured** | Takes effect only on next deploy |

### Non-secret target identity (so a later agent picks the right target)

| Thing | Value |
|---|---|
| Supabase project (identity) | `eoiqvdmvgaurlecdzqkp` — "portabase.dev" |
| Supabase project (replay restore target — **not** identity) | `svltssnxzqsrxtbjgaex` — "portabase-replay-proof" |
| Shared portfolio project (**must not** be used for this product) | `ekklokrukxmqlahtonnc` — "DataAutomation" |
| GCP project (Portabase consent screen) | `portabase-dev` / `495102144848` |
| GCP project that must **not** be used | `massageexam` — NYS Massage Exam |
| Netlify site id | `794217cc-42ab-4a9f-81da-06a661403573` |
| Deploy mechanism | **No Git linkage** — `build_settings` is empty, so Netlify does **not** build from a branch. Deploys are manual (`netlify deploy --prod`). Merging to `main` alone ships nothing. |
| Publishable key (public) | `sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL` |

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

## Remaining holes, in order

1. **Deploy the app bundle.** The browser code (id_token flow, single GoTrue
   client, callback handling) is committed but **not deployed**. The live site
   still serves the old bundle, which uses the broken `signInWithOAuth` code
   exchange and still points at the shared project. Nothing about sign-in works
   for a real user until this ships. Note the site has no Git linkage — merging
   to `main` does **not** deploy; someone must run a manual deploy.
2. **Get the branch to the org remote.** Work is on
   `agent-checkpoints/claude/5075c12e-google-oauth`, pushed only to
   `old-origin` (`lcapece/portabase.dev`). Pushes to `origin`
   (`data-automation-ai/portabase.dev`) were denied twice by the local
   permission classifier; the org PAT itself holds `push: true, admin: true`.
3. **Upload the consent logo** (manual, ~30s): Branding → Browse →
   `public/icons/portabase-consent-120.png`. Free while in Testing.
4. **Decide on publishing status.** The app is in **Testing**, so only listed
   test users can sign in — everyone else gets "Access blocked". Publishing to
   Production is required for real users. See the tradeoff below.
5. **Write a privacy policy and terms page.** Both consent-screen fields are
   empty because `portabase.dev` has no `/privacy` or `/terms` route. Google
   requires a privacy policy to publish an External app.
6. **Run the live proof** (below).

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
- [ ] Click Google on the deployed `https://portabase.dev/login` (needs the new bundle)
- [ ] Returns to the app with a **valid session** (inspect the user object, not just the UI)
- [ ] `/app` (protected route) loads
- [ ] Sign out clears the session
- [ ] After sign-out, `/app` is denied
- [ ] Popup-blocked path: block popups, confirm the redirect fallback completes
- [ ] Bundle scan: correct client id present, no client secret, no other product's id

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

## Verified so far (2026-08-20)

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

- Nothing has been tested against a live Google account — the OAuth client does
  not exist yet.
- Email signup confirmation and password recovery have **not** been re-tested
  since `detectSessionInUrl` was set to false. Both land on the same callback
  route this change touches.
- Nothing is deployed. Work sits on branch
  `agent-checkpoints/claude/5075c12e-google-oauth`, pushed to **`old-origin`**
  (`github.com/lcapece/portabase.dev`) only. `origin`
  (`github.com/data-automation-ai/portabase.dev`) rejected the push with 403
  because the cached credential is `lcapece`. The org PAT in `secrets-bundle`
  (`github-dataautomation-ia-pat`, user `data-automation-ai`) **does** hold
  `push: true, admin: true` on that repo — verified via the GitHub API — but the
  push itself was denied twice by the local permission classifier and was not
  retried around. Work reaching the org remote and then `main` is still open.
- `.env.example` changes (`VITE_GOOGLE_OAUTH_CLIENT_ID`, new project URL) are
  **local-only and uncommitted** — that file already carried pre-existing edits,
  so it was deliberately excluded from the checkpoint commit rather than
  entangling two authors' work. It is not crash-safe.
# Portabase site — status

## Definition of Done

A signed-in customer on **https://portabase.dev** connects one Supabase project, saves what the capsule should cover, and queues a **manual** backup. A worker they start (`node cloud/runner/worker.mjs`) pulls that job and runs the free engine with secrets that were already on that machine. The capsule lands in **their** vault. The site shows queued / running / finished and never receives the passphrase, database URL, or capsule bytes.

Not this definition: a managed Portabase server that runs the job for them, a paid schedule, or a green replay. Those stay separate rows until they have live proof.

**This repo is not that yet.** The queue and the pull worker are implemented below. They are not deployed, and no live job has been pulled.

## Capability ledger

Status vocabulary: scaffolded / implemented / deployed / verified / complete. Nothing is complete without live proof.

| Capability | Status | Evidence | Next hole |
|---|---|---|---|
| Square $7 checkout (cloud-7) | implemented (pre-existing) | netlify/functions/cloud-subscribe.mjs | live charge not proven (docs/CLOUD.md) |
| Connect Supabase via PAT (in-request only) | implemented, not live-verified | netlify/functions/cloud-supabase.mjs | live probe with a real PAT |
| List projects | implemented, not live-verified | same | live probe |
| Table + bucket sizes | implemented, not live-verified | netlify/shared/supabase-mgmt.mjs | live probe |
| Pick tables/buckets under cap (UI) | implemented | src/console/connect-supabase.jsx, table-sizer.jsx | browser walkthrough on deploy preview |
| Save selection server-side | implemented, not live-verified | netlify/functions/cloud-selection.mjs | live probe |
| Engine honors selection (--exclude-table-data / --exclude-buckets) | implemented, unit-tested | utility/portabase.mjs, tests/selection-flags.test.mjs | real backup against a test project |
| Managed runner runs saved selection on schedule (1/24h) | scaffolded | cloud/runner/boot.mjs still idles. No scheduler. | Not this slice. Paid schedule is still unbuilt. |
| Manual backup intent + customer worker pull | implemented, not live-verified | netlify/functions/cloud-jobs.mjs claim/finish; cloud/runner/worker.mjs; Connect Supabase "Queue manual backup" | Deploy this branch, sign in, queue one job, run the worker against a real project |
| Incremental binary option | implemented, not live-verified | Whole file only. A greater date stamp is differential and the entire file is fetched. Etag is not the rule. | A second backup where one binary file's date stamp moved forward |
| Deployed to production (deploy-live) | NOT deployed | branch pushed to origin; merged to `main` — Netlify deploys are manual (`netlify deploy --prod`), merge alone ships nothing | manual deploy + live proof |
