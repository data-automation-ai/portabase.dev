# Cloud $7 Feature — Project Status

Capability ledger. Status vocabulary: scaffolded / implemented / deployed / verified / complete. Nothing is complete without live proof.

| Capability | Status | Evidence | Next hole |
|---|---|---|---|
| Square $7 checkout (cloud-7) | implemented (pre-existing) | netlify/functions/cloud-subscribe.mjs | live charge not proven (docs/CLOUD.md) |
| Connect Supabase via PAT (in-request only) | implemented, not live-verified | netlify/functions/cloud-supabase.mjs | live probe with a real PAT |
| List projects | implemented, not live-verified | same | live probe |
| Table + bucket sizes | implemented, not live-verified | netlify/shared/supabase-mgmt.mjs | live probe |
| Pick tables/buckets under cap (UI) | implemented | src/console/connect-supabase.jsx, table-sizer.jsx | browser walkthrough on deploy preview |
| Save selection server-side | implemented, not live-verified | netlify/functions/cloud-selection.mjs | live probe |
| Engine honors selection (--exclude-table-data / --exclude-buckets) | implemented, unit-tested | utility/portabase.mjs, tests/selection-flags.test.mjs | real backup against a test project |
| Managed runner runs saved selection on schedule (1/24h) | scaffolded | cloud/runner/boot.mjs idles | build poll→spawn loop |
| Deployed to production (deploy-live) | NOT deployed | branch agent-checkpoints/claude/1eba90f1-cloud7 is local-only (push 403) | user push + merge approval |
