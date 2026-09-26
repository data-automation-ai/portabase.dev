# Homepage draft — fire-insurance pass (2026-09-24)

The page already carries the research (founder note, vulnerable middle,
48-hour timeline, linked stories, closure risks). This draft adds the
six decisions from the positioning session as targeted copy changes.
No section reordering. Supabase stays praised; paid tier recommended
for production.

## 1. Hero — fire-insurance frame

Current brandline: "Is great—until the doors are locked."
Keep it. Add directly under the H1, before the lead paragraph:

> **Fire insurance for your database. Nobody shops for it after the fire.**

Rationale: names the category (insurance, not backups), the timing
(before), the buyer (owner-operator). One line, above the fold.

## 2. Hero lead — Dropbox-first, paid-production line

Current lead ends "...stores the capsule where you choose."
Append one sentence:

> Connect Dropbox in minutes — no key pairs, no storage console.
> Free Supabase is for building; production deserves a paid project
> and a $7 escape.

## 3. WhyNow — timezone one-liner

In `.gap-close` paragraph (already mentions Singapore entity +
24–48h target), add the neutral timezone line:

> When your business goes down at 10am, it can be 10pm where your
> ticket gets read.

One line only. No legal claims, no adversarial tone.

## 4. New free content — RLS / anon-key prevention guide

New docs page (`/docs/rls-check`): what the anon key is, why RLS-off
means open, three queries that check exposure. Tone rule: the villain
is the default, never the user ("Supabase ships with the door unlocked
and the instructions assume you know that").

Homepage hook — add to the Reality 12-reason grid as item 13, or a
one-line strip under Stories:

> Bonus risk: your database may already be public. Most vibe-coded
> projects leave RLS off with the anon key in the frontend — readable
> by anyone. [Check yours in 5 minutes →](/docs/rls-check)

Later console feature: read-only RLS-status scan per table (metadata
only — zero-knowledge clean).

## 5. Cloud page — cold / warm ladder

Replace any "hot replica" language with:

- **Cold (every plan):** encrypted escape in your Dropbox.
- **Warm ($17 / premium):** standby Supabase project, refreshed on
  schedule + re-adapt runbook. Re-pointable in an hour, not a millisecond.
- **Hot:** never promised.

## 6. Copy rules (hold for all future edits)

1. Quote SLAs verbatim with link + plan tier. Never paraphrase.
2. Praise Supabase as the platform; recommend paid tier for production.
3. Every incident claim keeps its exact href. No invented stats.
4. Time zones, not jurisdiction. Defaults, not users, are the villain.

## Out of scope for this pass

Serper monthly refresh, auth wiring, Dropbox vault build, warm-standby
build, re-adapt runbook — separate phases, in that order.
