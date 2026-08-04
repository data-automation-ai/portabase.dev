# Portabase Cloud Console

Professional recovery ops console. **Portabase product**, not a Supabase Dashboard clone.

## Design intent

- **Borrow:** clear sidebar, dense tables, status badges, calm dark UI, keyboard-friendly filters  
- **Do not copy:** Studio table editor, SQL, Auth users, Storage browser, or Supabase nav taxonomy  

Tone: *did the capsule land, can we restore, who gets woken* — instrument panel for DR.

## Nav (7 items)

| Item | Purpose |
| --- | --- |
| **Home** | Recovery status, RPO, recent events |
| **Sources** | Supabase projects you protect (labels/refs only) |
| **Backups** | Capsules + schedule |
| **Agents** | Your runners (+ optional managed) |
| **Alerts** | Escalation chains, channels, event feed |
| **Replay** | Validate capsule by restoring into a **new blank** Supabase project/account |
| **Account** | Plan, team, destinations, **CloudTrail live**, settings |

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

`src/console/` — shell, CSS, pages, local store. Never accepts passphrases or capsule bytes.
