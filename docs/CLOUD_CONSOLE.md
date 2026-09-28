# Portabase Cloud Console

Professional recovery ops console. **Portabase product**, not a Supabase Dashboard clone.

## Design intent

- **Borrow:** clear sidebar, dense tables, status badges, calm dark UI, keyboard-friendly filters  
- **Do not copy:** Studio as the console IA. Live table/storage browsing is a **separate client-side tool** that talks only to the customer’s Supabase — never a capsule inventory.

Tone: *did the capsule land, can we restore, who gets woken* — instrument panel for DR.

## Nav

| Item | Purpose |
| --- | --- |
| **Home** | Recovery status, gauges (capsule / rescue / storage / workers), **transfers used / 24h** (1 or 3), RPO, recent events |
| **Sources** | Supabase projects you protect (labels/refs only) |
| **Live Supabase** | Browser-only explorer of the **live** project (URL+key stay in-tab). Not the capsule. |
| **Capsules** | Manage (register, schedule, verify, retention, destination, **customer-side key injection**) — not a content browser |
| **Telemetry** | Graphical health signals only (success/fail, duration, encrypted-byte aggregates, workers, plan cap, rescue, drift counts) |
| **Open capsule** | Customer-side inspect wizard — local file or CLI `verify --decrypt`. Portabase cannot open the archive. |
| **Agents** | Your runners (+ optional managed) |
| **Alerts** | Escalation chains, channels, event feed |
| **Replay** | Validate capsule by restoring into a **new blank** Supabase project/account |
| **Account** | Plan, team, destinations, **CloudTrail live**, settings |

### Telemetry (Cloud dashboard)

Graphs and gauges of **allowlisted health signals**: job success/fail, timing, ciphertext size totals if the runner reported them, worker online counts, plan usage vs Square GB cap, **transfers used in the rolling 24h window** (allowance 1, or 3 with Extra transfers), rescue readiness, drift pass/fail counts, a status timeline.

**Provably zero-knowledge:** this page must never list Storage object names/paths, table row contents, or capsule plaintext inventory. It must not imply Portabase can see inside the capsule. Ciphertext-only echoes; runner-originated aggregates; no server-side decrypt. View-model: `src/lib/telemetry-view.js`. Law: `docs/ZERO-KNOWLEDGE.md`.

### Live Supabase viewer (not the capsule)

`/app/supabase-viewer` and `/tools/supabase-viewer`. Customer pastes project URL + anon/service key. `@supabase/supabase-js` + PostgREST OpenAPI / Storage run **in the browser** toward the customer project. Keys and query results are never POSTed to Portabase `/api/*`. Management API is fail-closed (CLI fallback). sessionStorage is opt-in; default memory-only; wipe clears the tab.

**Still in force:** Cloud cannot list capsule object names or plaintext.

### Open capsule (zero-knowledge inspect)

Decrypt happens **only** with the customer’s passphrase on their side:

- Browser: pick a local `capsule.json` (layer flags / status) or acknowledge a `.pbase` as sealed ciphertext. WebCrypto **cannot** run CLI scrypt (N=32768) or stream multi-GB archives — the UI says so.
- CLI: `portabase verify --capsule <dir> --decrypt` on the machine that has the key.
- Passphrase is fingerprinted locally then discarded. **Never POSTed to Cloud APIs.**
- We do **not** fake a server-side peek.

### CloudWatch live (Account tab) — secret-scoped

- **Always on** for managed jobs: logs accumulate even if the customer never opens the panel (retroactive within retention).
- **Scope:** one secret at a time  
  - Log group: `/portabase/tenants/{workspaceId}/secrets/{secretId}`  
  - Stream prefix: `secret/{secretId}` or `secret/{secretId}/job/{jobId}`
- **Demo:** synthetic tail until the log group exists / API is live.
- **Live:** `POST /api/cloud/cloudwatch-live` → `FilterLogEvents` with secret scope; responses **redact** secret-shaped strings.
- **Not shown:** other tenants, other secrets, raw passphrase/service-role values.

### CloudTrail live (Account tab)

- **Demo:** synthetic near-live events so non-experts understand the feed before AWS setup.
- **Live:** customer pastes an IAM role ARN (+ external ID) that allows `cloudtrail:LookupEvents`. Netlify function `cloud-audit-trail` AssumeRoles and polls Trail.
- **Not live:** sub-second streaming. AWS CloudTrail is **near-real-time** (often 1–5 minutes).
- Never displays passphrases or capsule bytes — only API event metadata.

**Mental model:** CloudWatch live = “what did Portabase’s runner do for *this secret*?” · CloudTrail live = “what hit *my* AWS APIs?”

## Entry

- `/app` — authenticated (Supabase or AWS version)  
- `/app?demo=1` — full UI with demo data  

## Stack

`src/console/` — shell, CSS, pages, local store. Cloud APIs never receive passphrases or capsule bytes. The Open capsule wizard may read a **local** file / passphrase in the tab only, then discard them.
