# Portabase — capability & evidence ledger

Scope of this file: **Google sign-in for Portabase Cloud identity.** Other
capabilities (capture, restore, replay, Square billing) are tracked in
`PROJECT.md` and `docs/HANDOFF.md`.

Status vocabulary is the portfolio one: *scaffolded → implemented → provisioned
→ configured → deployed → verified → complete*. Never substitute one for
another.

**Overall status: INCOMPLETE — BLOCKED on the Google OAuth client.**

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
| Dedicated Supabase project | Supabase org `capece` (Pro) | ✅ `eoiqvdmvgaurlecdzqkp`, us-east-1, ACTIVE_HEALTHY, created 2026-08-20 | ❌ Google provider not set | n/a | ❌ | n/a | **provisioned** | Google client id/secret |
| Google OAuth client | Google Cloud Console | ❌ does not exist | ❌ | n/a | ❌ | n/a | **BLOCKED** | Human step — console values published to the operator 2026-08-20 |
| Google client secrets in `secrets-bundle` | AWS `899867382621` | ❌ no `portabase-google-oauth-*` keys | ❌ | n/a | ❌ | n/a | **BLOCKED** | Depends on the row above |
| Supabase Auth → Google provider | Supabase Management API | n/a | ❌ | n/a | ❌ | n/a | **BLOCKED** | Depends on client id/secret. Automatable via `supabase-token` — no dashboard step needed |
| id_token sign-in flow (browser) | `src/lib/google-gis-auth.js` | n/a | n/a | ❌ not merged to `main` | ❌ | ⚠️ partial | **implemented** | Live proof requires the OAuth client |
| Single GoTrue client / no URL-handler race | `src/lib/supabase-auth.js` | n/a | ✅ `detectSessionInUrl: false` | ❌ | ❌ | ✅ guarded by test | **implemented** | — |
| Product isolation guard | `tests/google-oauth-isolation.test.mjs` | n/a | ✅ | ❌ | ✅ 9/9 pass, **mutation-tested** (4/4 seeded regressions caught) | ✅ | **verified (CI-level)** | — |
| Netlify env vars for the new project | Netlify site `794217cc-…` | n/a | ❌ `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_OAUTH_CLIENT_ID` not set | ❌ | ❌ | n/a | **not configured** | Must be set before merge, or the deployed bundle ships an unconfigured client |

### Non-secret target identity (so a later agent picks the right target)

| Thing | Value |
|---|---|
| Supabase project (identity) | `eoiqvdmvgaurlecdzqkp` — "portabase.dev" |
| Supabase project (replay restore target — **not** identity) | `svltssnxzqsrxtbjgaex` — "portabase-replay-proof" |
| Shared portfolio project (**must not** be used for this product) | `ekklokrukxmqlahtonnc` — "DataAutomation" |
| Netlify site id | `794217cc-42ab-4a9f-81da-06a661403573` |
| Deploy branch | `main` (Netlify builds `dist/` from it) |
| Publishable key (public) | `sb_publishable_OSrYsvzHMubG3YWYUSq6vw_BqEpNQyL` |

---

## Remaining holes, in order

1. **Create the Google OAuth client** (human, Google Cloud Console). Exact
   consent-screen values, JavaScript origins, and the five redirect URIs were
   published to the operator on 2026-08-20.
2. **Store** `portabase-google-oauth-client-id` / `-client-secret` /
   `-updated-at` in `secrets-bundle`.
3. **Configure** Supabase Auth → Google provider on `eoiqvdmvgaurlecdzqkp` with
   that client id + secret, and set the site URL / redirect allowlist.
   Automatable with `supabase-token` via the Management API.
4. **Set Netlify env vars** on site `794217cc-…`, then merge the checkpoint
   branch to `main`.
5. **Run the live proof** (below). Until it passes, this capability is not done.

## Live proof checklist — none of these have been observed yet

- [ ] Click Google on `https://portabase.dev/login` → account chooser appears (not "Access blocked")
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
- Full suite passes: `npm test` → **107/107**, including the 9 new isolation tests.
- Isolation guard **mutation-tested** — shared project ref reintroduced,
  client id hardcoded, `detectSessionInUrl` flipped true, and a foreign product
  domain leaked in were each caught, and the baseline restored to 9/9.
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
