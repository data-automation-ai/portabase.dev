# Portabase Cloud — Auth + 7-day trial

**Launch: Supabase only.** See [LAUNCH-SCOPE.md](./LAUNCH-SCOPE.md).

| | |
| --- | --- |
| **Identity** | Hosted Supabase Auth (email + Google ID-token exchange) |
| **Product** | Supabase projects (DB · Auth · Storage · Edge Functions) |
| **Trial** | 7 days · **card required** · auto-converts to **$7** (one DB · 10 GB · 1/24h) or **$17** (unlimited DBs · 25 GB · 3/day) |
| **Agents** | Up to 12 |
| **Storage** | Customer BYO capsules — Portabase never hosts recovery bytes |

AWS Cognito identity remains in the codebase (`src/lib/cognito.js`, `AWS_CLOUD_VERSION_ENABLED`) for a later release. It is **not** offered in the UI at launch.

> Hosted Supabase only. Self-hosted Supabase is **deprecated**.

## Login

- `/login` — Supabase Auth only (callout: “Supabase only”) — **email password, email magic link, and Google**
- `/login?version=aws` is normalized back to Supabase while launch flag is off
- Session stored client-side; API calls send:

```http
Authorization: Bearer <supabase_access_token>
X-Portabase-Cloud-Version: supabase
```

Subscriptions are namespaced as `{version}:{userId}` (always `supabase:…` at launch).

## Flow (Supabase)

1. Email signup, email login, magic link, password recovery, or Google login
2. Callback `/auth/callback` exchanges an email PKCE code, verifies an email token hash, or receives a Google ID token
3. Bearer = Supabase **access token**
4. Server: `supabase.auth.getUser(jwt)` in Netlify functions

## Trial → subscription

1. Signed-in user opens console (`/app`)
2. `POST /api/cloud/subscribe` creates Square payment link (trial phase $0 × 7 days → chosen $7 or $17 plan)
3. Redirect back `/app?checkout=complete`
4. `POST /api/cloud/confirm-checkout` + Square webhooks update subscription state
5. After trial, Square charges the card on file

Details: [BILLING.md](./BILLING.md), [SQUARE_SETUP.md](./SQUARE_SETUP.md).

## API surface

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/auth-config` | Public Supabase URL/anon + launch flags |
| GET | `/api/cloud/me` | Verify JWT; return user + subscription |
| POST | `/api/cloud/subscribe` | Start Square trial checkout |
| POST | `/api/cloud/confirm-checkout` | Confirm after redirect |
| * | `/api/cloud/jobs` | Agent job queue (Bearer required) |

## Configure Supabase Auth

1. Hosted project Auth → enable Email + Google
2. Redirect URLs must include production + local:

   - `https://portabase.dev/auth/callback`
   - `http://localhost:5173/auth/callback` (dev)

3. Site URL / additional redirects as needed for `/app`

The Google client ID is public and must be configured both in Netlify and in the Supabase Google provider. The Google client secret stays in the **Supabase dashboard** (Authentication → Providers → Google) and must never enter Portabase git or a browser bundle.

Placeholders (never commit real values):

| Name | Where |
| --- | --- |
| `VITE_GOOGLE_OAUTH_CLIENT_ID` | Netlify build environment (public) and the matching Supabase Auth Google provider client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Supabase Auth Google provider |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | Optional Netlify build (public) |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Netlify functions |

The site uses `@supabase/supabase-js` PKCE for email links and exchanges a Google ID token with the dedicated Supabase Auth project (`src/lib/supabase-auth.js`). Portabase never stores the Google client secret.

## Code map

| Area | Path |
| --- | --- |
| Version flag | `src/lib/cloud-versions.js` (`AWS_CLOUD_VERSION_ENABLED = false`) |
| Supabase Auth client | `src/lib/supabase-auth.js` |
| Session | `src/lib/session.js` |
| Login UI | `src/auth-pages.jsx` |
| Verify (server) | `netlify/shared/verify-user.mjs`, `supabase-auth.mjs` |
| Cognito (dormant) | `src/lib/cognito.js`, `netlify/shared/cognito-jwt.mjs` |

## Launch checklist

1. [x] Supabase Auth Google + email enabled on production project (read-only settings check, 2026-10-05)
2. [ ] Redirect URLs include `https://portabase.dev/auth/callback`
3. [x] Netlify build/runtime env has Google client ID, Supabase URL, and public key (presence-only check, 2026-10-05)
4. [ ] Square secrets for trial/subscription
5. [ ] Confirm `AWS_CLOUD_VERSION_ENABLED` stays `false` until AWS product path ships
