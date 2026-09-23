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
| Incremental binary option | implemented, not live-verified | POST /api/cloud/jobs `incrementalBinary: true` → worker `--incremental-binary`. Unchanged local binaries are not fetched again; a cache miss still fetches. | A second backup of a project that already has binary objects on the worker |
| Deployed to production (deploy-live) | NOT deployed | branch agent-checkpoints/grok/site-objective is local until pushed | user push + merge approval |
