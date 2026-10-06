# Session handoff — 2026-10-06 (private runner GUI work)

This is a resume pointer for the next session on the private-runner setup UI.
Read `docs/RECOVERY-HANDOFF-2026-10-04.md` first for the broader interrupted
backlog this sits on top of — that document's "first rule: preserve the
checkout" still applies. This file covers only what changed today.

## Repository state

- Branch: `agent/muse-telemetry-read-api`. HEAD and `origin` match at
  `dab2f4e` (pushed).
- Today's commits, in order: `53cf00b` (Verifiability panel + consolidated
  connect modal), `ccf00bc` (`.gitignore` fix — see Security below),
  `8ad6585` (PROJECT_STATUS.md pricing-decision entry, carries ~855
  pre-existing lines from 2026-10-04/05, see caveat below), `dab2f4e`
  (two-column source/destination form + 3-node diagram).
- Everything else in the working tree (~220 dirty paths: `cloud/runner/*`,
  `netlify/functions/*`, `src/console/*`, many untracked test/source files)
  predates this session by 2+ days and was **not touched or committed** by
  this session. It is the interrupted backlog from `RECOVERY-HANDOFF-2026-10-04.md`.
  Do not assume it is reviewed or safe to commit as-is.

## What actually works right now (verified live in a real browser, not just unit tests)

Launch command used this session (from repo root):

```
PORTABASE_RUNNER_ID="39057c5a-9775-47d2-9eaf-620caad67455" \
PORTABASE_RUNNER_CONFIG_DIR="$(pwd)" \
PORTABASE_PROJECT_REF="ekklokrukxmqlahtonnc" \
node utility/portabase.mjs ui --private-setup --no-open
```

This prints a `http://127.0.0.1:<port>/#t=<token>` URL. The project ref must
be exactly the one in `portabase.config.json` (`ekklokrukxmqlahtonnc` — the
shared pseudo-isolation Supabase project; see global CLAUDE.md for its
isolation status) because `runner-state.mjs` fails closed on any mismatch —
there is **no real re-binding of a runner to a different project**, see
Known gaps below.

Confirmed working end-to-end against the real project:

- Single consolidated "Connect your Supabase project" modal (previously a
  separate inline form + separate popup).
- Two-column **Source | Destination** layout for Project URL, DB password,
  and secret key, with a **"Create the capsule only (no automatic restore)"**
  checkbox that grays out the destination column.
- Project URL/reference field accepts either `https://<ref>.supabase.co` or
  the bare 20-char ref (`parseProjectRef` in `app.js`).
- 4-step animated probe: **URL → Project → Database → API** (API rolls up
  Storage + Edge Functions sub-checks). Real live run against
  `ekklokrukxmqlahtonnc` returned **762 tables, 17 Storage buckets, 75 Edge
  Functions**, 29/29 schemas cataloged live.
- 3-node connection diagram: **Source Supabase ↔ Runner ↔ Target Supabase**,
  animated request/response arrows on both sides. Target side hides
  entirely when "capsule only" is checked; otherwise shows labeled
  "not yet validated" (honest — no backend probe exists for it yet).
- On a failed connection: values are preserved (not wiped), the form
  reappears automatically, the specific field most likely at fault flashes
  red (`flagFieldError` / `.field-error` CSS), and the failure message names
  the field.
- "Verifiability" button/modal: analogy for novice users, DevTools-based
  self-verification steps for advanced users (CSP inspection, Network tab
  filtering, a pasteable `crypto.subtle.digest` console command to hash
  `/app.js` yourself), and download links for the actual served `app.js`/
  `app.css`.
- "How the seal works" → deeper technical dialog now also explains the AWS/S3
  technology boundary and the "owning the runner vs. seeing inside it" tent
  analogy, including an honest caveat that the current build's private state
  file is not yet customer-key-encrypted.
- A **Cancel** button on the connect modal (does not abort the in-flight
  network request, just closes the dialog and returns to the entry screen).

All of this is backed by `node --test tests/ui-server.test.mjs` (15/15
passing — loopback-only, CSP, no-inline-script, no-credential-leak checks)
plus live manual verification via Claude-in-Chrome this session.

## Known gaps — stated, not hidden

1. **No live validation for the destination/target fields.** The target
   form only format-checks the ref and saves; a bad target password/key is
   only discovered at actual restore time. The diagram's "Target Supabase"
   node is cosmetic until this exists.
2. **No real re-binding of a runner to a customer-chosen project.** The
   Project URL/ref field only accepts a value matching the project the
   runner was launched with (`PORTABASE_PROJECT_REF`); typing a different
   valid-looking ref is correctly rejected, not silently accepted. Real
   support for this needs changes to `cloud/runner/runner-state.mjs` and
   `cloud/runner/private-config.mjs`, which key/validate state against a
   fixed `projectRef` set at process launch.
3. **No animation of actual data flow during a real backup run.** Everything
   built so far is the *connect/validate* screen. The "runner → target" and
   "runner → capsule archive storage" data-flow animation discussed at the
   end of this session (hub-and-spoke layout: Runner center, Source left,
   Target + Capsule Archive branching right) was only **ideated**, not
   built. No code exists for it yet.
4. **Per-object size cap / tier upsell (10GB vs 100GB "XL") is not
   implemented in code**, only decided and recorded in `PROJECT_STATUS.md`'s
   `2026-10-06 runner storage tier decision` section. `utility/job-capsule-limit.mjs`
   only caps total assembled capsule size after the fact; there is no
   per-object pre-check or customer-facing skip/disclosure flow yet.
5. **PROJECT_STATUS.md pricing history is a 5-way conflict, explicitly
   flagged in the file, not resolved.** Do not pick one silently.

## Security note from this session

`runtime-secrets.json` (plaintext Supabase credentials saved by the
private-setup UI when real values were entered during testing) was found
sitting **untracked and ungitignored** in the repo root. It was never staged
or committed (confirmed via `git ls-files`), but has now been added to
`.gitignore` (`ccf00bc`) along with `.local-runner-state/`. **Recommend
rotating the DB password, service role key, and access token on project
`ekklokrukxmqlahtonnc`** as cheap insurance, since it sat in plaintext on
disk during an active session.

## Suggested next steps, in order

1. Rotate the credentials mentioned above.
2. Decide: build the hub-and-spoke 4-node animation (Runner / Source /
   Target / Capsule Archive) now, or move to making the target connection
   actually validate live (gap #1) — the diagram is more convincing once
   backed by a real check.
3. Review the ~220-path pre-existing dirty-tree backlog from
   `RECOVERY-HANDOFF-2026-10-04.md` — it has not shrunk, only had today's
   isolated UI work committed on top of it without touching it.
4. If/when ready to actually run a real backup (not just inventory), that
   still requires wiring this setup UI to a real job execution path — not
   yet connected.
