# Free open-source CLI

The recovery engine is free. No Portabase account is required.

Install (customer path, also in `src/lib/product.js`):

```bash
npm i -g portabase
```

Source: [DataAutomation-ai/portabase-CLI](https://github.com/DataAutomation-ai/portabase-CLI) · [npm `portabase`](https://www.npmjs.com/package/portabase).

## Capture → verify → restore

Commands match the repo README and `docs/REPLAY.md`. From a clone you can also run `npm run portabase -- <cmd>` instead of the global binary.

```bash
portabase init
portabase doctor
portabase backup
portabase verify --capsule ./portabase-capsules/CAPSULE_NAME
portabase restore --capsule ./portabase-capsules/CAPSULE_NAME
portabase restore --capsule ./portabase-capsules/CAPSULE_NAME --execute --confirm-target NEW_PROJECT_REF
```

Optional limited sample (README):

```bash
portabase backup --trial
```

Replay into a **new blank** Supabase project — never the source (`docs/REPLAY.md`):

```bash
portabase replay --capsule ./portabase-capsules/CAPSULE_NAME --confirm-target NEW_PROJECT_REF --preflight
portabase replay --capsule ./portabase-capsules/CAPSULE_NAME --confirm-target NEW_PROJECT_REF
```

Existing size-fit flags only (`docs/CLOUD.md`): `--exclude-binaries`, `--exclude-table-list`. No invented CLI flags.
The Cloud dashboard table sizer uses this same doctor / size inventory to include or exclude tables and Storage buckets — it does not add capture flags.

Passphrase (`PORTABASE_ENCRYPTION_PASSPHRASE`, ≥16 characters) stays on the machine you run. Never paste it into portabase.dev.

## Free path vs Cloud

Most Supabase users can stay on this CLI plus a free destination when the capsule fits. Cloud is optional GUI, telemetry, and (on paid plans) schedules. See `docs/CLOUD.md`.
