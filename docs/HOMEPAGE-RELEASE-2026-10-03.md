# Homepage release: recovery message and recent evidence

Audience: a builder whose Supabase side project now has customers or businesses depending on it.

The first screen asks whether the business could survive 48 hours offline or permanent loss of its Supabase account. It explains a customer-controlled recovery copy in plain language, removes the yellow arrow and decorative italic headline ending, and retains the founder's actual lockout image.

The incident list follows the hero. All existing 2026 cases precede older reports. Default ordering is newest month, reported impact, then date; the alternate order is newest year, impact, then date. Dates come from the original source labels, not later replies. Reddit URLs are normalized by post ID so title slugs do not duplicate cases. Documentation-only storage behavior is excluded from the incident count; existing qualifications and source links remain.

## Evidence and release state

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
|---|---|---|---|---|---|---|---|---|
| Revised first screen | `src/main.jsx`, `src/recovery-home.css` | Existing Netlify site | Local source | Pending | Local browser at 320, 390, 768, 1280, 1440px | No new credentials or backend operations | Implemented and locally verified | Safe isolated production publication |
| Case ordering | `src/lib/incident-order.js` | n/a | Both sort modes | Pending | Local browser: 46 rows, 2026 first | Source links and disputed-report qualifications retained | Implemented and locally verified | Production readback |

Validation: Vite production build passed. Four incident-order tests passed. Browser checks found no horizontal overflow or JavaScript page errors at the five widths; the primary action fits above the fold. Evidence: ignored `portabase-evidence/homepage-20261003/`.

## Deployment continuity

Verified target: Netlify `794217cc-42ab-4a9f-81da-06a661403573`, `portabase-dev`, `https://portabase.dev`, account slug `lcapece`. Public authentication config identifies dedicated Supabase project `eoiqvdmvgaurlecdzqkp`.

Published baseline observed: `6ab288426450b9689079fdab` (2026-09-22), 15 functions, no edge functions. The current source checkout contains additional backend changes and a private-preview edge gate absent from production. Do not deploy the entire checkout for this homepage task. Preserve the live functions, authentication routes, billing paths, deployment configuration, and legal pages. Build from a clean detached worktree and record the exact release artifact before publication.

Rollback: republish the verified prior Netlify deploy with `netlify api restoreSiteDeploy --data '{"site_id":"794217cc-42ab-4a9f-81da-06a661403573","deploy_id":"6ab288426450b9689079fdab"}'`, then verify the public asset hashes and auth-config endpoint.

This change does not establish whole-product readiness or verify the existing Cloud recovery, billing, or authentication flows end to end.
