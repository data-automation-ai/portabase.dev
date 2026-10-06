# Private runner UI — industrial metal redesign spec

Single source of truth for the visual redesign of `utility/ui/static/private/`
(the loopback setup page served by `node utility/portabase.mjs ui --private-setup`).
Written 2026-10-06 to stop scope from re-deriving mid-session. Whoever executes
this (any model, any session) should follow this file, not conversation history.

## Reference

`PortaBase Cloud Runner Dashboard.png` (repo root) — mood/palette reference.
**Inspired by, not a pixel match.** Industrial metal, not a literal recreation.

## Direction (confirmed, do not re-litigate)

- Palette: light brushed-metal gray base, **blue = source/primary**, **green =
  target/secondary/success**. No more orange/cream.
- Site-wide, not just the connect modal — header, hero, every section.
- Bezel look: rounded-rect panels with corner rivet dots (already prototyped
  in the connect modal — see "Already implemented" below).

## Truthfulness constraints (hard rule, not a style choice)

The real backend has real gaps. The redesign must not visually claim
capabilities that don't exist:

- **No "Start Transfer" button or equivalent.** The server prints
  "no job execution" on its own startup banner — there is no code path that
  executes a backup/restore yet (`PROJECT_STATUS.md`: "No production runner
  proven"). Keep the existing real action labels (`Probe source now`,
  `Create private job reference`, `Download job reference`) — restyle them,
  don't rename them into false promises.
- **No Google Drive / Dropbox destination icons.** Only S3 restore exists in
  code (`utility/storage-s3-restore.mjs`). Don't add icons for unimplemented
  destinations.
- **No "Open source and trustworthy" badge** or equivalent claim unless
  independently confirmed true. Use only claims the existing architecture
  text already backs, e.g. "Your keys stay with you," "We never see your
  secrets" (consistent with the existing "How the seal works" / technical
  dialog content already in `index.html`).
- **Manifests / Run Log / Transfer Log / Manifest Preview tabs**: the
  "Transfer Log" tab can reuse the existing real local event list
  (`#events` / `.event-list` — already populated from real local activity).
  A "Manifest Preview" tab has no backing data yet — if added, must say
  "Not yet available" honestly, not show fake content.

## The zipper-close feature ("Close the zipper" button)

Confirmed behavior, already implemented and tested live:

- Header button "Close the zipper" → opens dialog `#closeZipperModal`.
- Confirm scene: user must type exactly `I confirm` (case-insensitive) to
  enable the "Seal it" button. Cancel closes without effect.
- On confirm, scene swaps (same dialog, same box — **floating square modal,
  not full-screen**) to the animation stage `#zipperStageScene`.

### Animation — current direction (supersedes earlier flap/curtain version)

Two doors sliding shut, not a flap+curtain:

1. `.zipper-door-left` slides in from the left edge, `.zipper-door-right`
   slides in from the right edge, meeting at the center — both doors are
   metal-gradient panels filling the square stage top-to-bottom.
2. Once closed, `.zipper-sticker` — a tamper-evident hazard-striped sticker
   (yellow/black diagonal stripes, dashed border, slightly rotated like a
   physical label) — fades/scales in straddling the seam between the two
   doors.
3. Sticker text: **"SEALED — Do not tamper with `<runner id>`"**. The runner
   id is already available client-side as `bootstrap.runnerId` (see
   `app.js` line ~320, `$('runner').textContent = bootstrap.runnerId`) —
   reuse that same value, populate `#zipperStickerId`.
4. Modal stays open with a "Close" button after the sticker appears
   (dismisses back to the page; this is cosmetic, not a real lock — there is
   no backend key-based lock yet, same caveat as the existing "Seal not
   verified" language already in `index.html`'s technical dialog).

### Implementation status as of this file's writing

- `index.html`: `#zipperStageScene` markup updated to the two-door + sticker
  structure (flap/curtain markup removed).
- `app.css`: `.zipper-door`, `.zipper-door-left/-right`, `.zipper-sticker`
  rules added; old `.zipper-flap`/`.zipper-curtain`/`.zipper-seam`/
  `.zipper-pull`/`.zipper-label` rules removed.
- `app.js`: **NOT YET UPDATED.** Still references the old class names
  (`flap-down`, `zip-up`, `sealed` applied to old elements) from the
  `$('zipperConfirmSubmit').addEventListener('click', ...)` handler. Needs:
  - Replace the `flap-down`/`zip-up` class toggles with a single
    `doors-closed` class toggle on `#zipperStageScene`.
  - Set `$('zipperStickerId').textContent = bootstrap.runnerId` before/when
    showing the sealed sticker.
  - Keep the `sealed` class toggle (sticker fade-in) and the existing
    `resetZipperModal()` cleanup logic — just update which classes it
    removes to match the new names.
  - **Until this is done, the modal is visually broken** (doors and sticker
    exist in CSS/HTML but nothing triggers them).

### Shape

- `#closeZipperModal` (`.zipper-modal`): square-ish floating popup,
  `width:min(380px,calc(100% - 28px))`, sharp corners (`border-radius:4px`,
  not the rounded pill look other dialogs use).
- `#zipperStageScene` (`.zipper-stage`): `aspect-ratio:1/1` — a true square,
  not a wide rectangle.

## Phased plan for the rest of the page (not started beyond the connect modal)

1. **Global theme** — swap `:root` CSS variables in `app.css` from
   cream/orange to metal/blue/green. *(Already done for `:root` itself —
   verify it cascades correctly across every section, not just the modal.)*
2. **Header** — logo mark + wordmark, tagline, right-side two-line trust
   badges with icons, using only the truthful claims listed above.
3. **Source/Target cards** — bordered panel cards (blue left-border source,
   green left-border target) for the connect form, extending the dual-grid
   work already partly done in the modal.
4. **Central runner-module diagram** — promote the existing 3-node probe
   diagram (currently only inside the connect modal) into a persistent
   on-page diagram once connected; restyle the existing `.execution-map` /
   `.data-path` sections rather than building new ones.
5. **Tab bar** — Database Inventory / Storage Objects / Transfer Log (real
   data) / Manifest Preview (honestly marked not-yet-available).
6. **Bottom action bar** — restyle existing real buttons into a button-row
   matching the mockup's visual rhythm, without inventing new actions.

## Already implemented (verified live in browser this session)

- Connect-modal (`.inspection-dialog`) metal skin: rivet-dot corners,
  blue/green split rule bar, blue Source node, green Target node, dark-metal
  center "PortaBase runner" module, blue active-step status cards. Verified
  against a real live probe of `ekklokrukxmqlahtonnc` (29/29 schemas).
- Zipper confirm-gate dialog (type "I confirm" to enable Seal).
- Checkpointed to branch `checkpoint/zipper-runner-ui-20261006` (commit
  `98563ce`), pushed to `origin`. **Not yet merged into the deploy branch —
  integration still required**, and the two-door rework above is not yet
  committed (still local, app.js incomplete).
