# Panel repair — connected panels restored and verified

Target: `codex/12gb-timing-20261025` in this worktree. Preserve the original chassis, layout, meters, source and destination capabilities. Simplify with disclosures and one Mode dropdown, not replacement controls or sample connections.

## Verified facts

- Port 4197 is an isolated sample-data preview. It cannot authorize real provider accounts or run recovery jobs. Do not present it as the connected system.
- The original connected helper is `cloud/confidential/customer-dry-run-session.mjs`, port 58441. Its start attempt returned `confidential_service_unavailable`.
- Google account and project verified: project `portabase-dev`, number `495102144848`, controller region `us-central1`, revision `00021-tj8`.
- Encrypted saved connection profile exists in Secret Manager; latest version observed before restart was 136. No profile was deleted or replaced by the UI work.
- No runner VM was active. The isolated validation identity has three startup reservations within the rolling 24-hour window. The first expires October 28, 2026 at 04:01 Eastern. Existing backup/restore run history must be preserved.
- User approved the isolated startup reset. Counter was backed up in Netlify store `portabase-confidential-repair-audit`, key `startup-reset-2026-10-27T23-05-34.955Z`; compare-and-set reset preserved the one existing run record.
- Real helper on port 58441 recovered both Supabase grants, 18 source projects, 2 destination projects, Dropbox, and 718 tables plus 17 Storage buckets. Attestation and preflight passed. Browser Save & Close and both project check controls passed against the connected service; no capture or restore started.

## Repairs in source

- Original design restored, repeated security row moved to diagnostics, duplicate mode/execution forms removed, secondary connection details collapsed with account identity visible.
- Object modal moved outside collapsed diagnostics. Sample `/scope` route now saves sample selections; browser tests verified both save buttons, closing, reopening and persistence.
- Source project selection, batch mappings and target options preserved. Mapped destinations remain selected after refresh.
- Original helper had no `/vault-provider` or `/s3` handlers despite accepting those routes. Added dedicated handlers and an explicit execution-route guard. Dropbox uses the live runner's supported `vault.check` operation. Provider selection remains helper-local; S3 credential submission is sent through the attested channel but S3 is not live-qualified by this repair.
- Fixed capsule listing's out-of-scope command reference and removed its fabricated fallback capsule ID.
- Secondary connection details remain collapsed normally, but automatically open for pending account-switch authorization. Required separate-account confirmation is outside collapsed diagnostics. Focused tests cover both states.

## Evidence and limits

Focused GUI, refresh and vault-handler tests pass. `scripts/check-minimal-panel.mjs` verifies sample selection flows and intercepts account-switch requests to validate payloads. This is not live OAuth or end-to-end recovery proof.

## Operating mode: development

Owner requested Development mode with no startup limit. Dedicated validation admission entrypoint exempts only identity `6f454f7b-b490-4fe9-9c49-48ce5b6f4408`; production entrypoint defaults to production. Backup quotas, verified authentication, persistent request replay denial, attestation and overwrite protections remain enforced.

- Clean sparse release source: `301b55874a201eefdd5f1fb5cbb0906a6e16ab49` in `panel-development-release`.
- Working isolated deployment: `6ae13026e2b5d043da3537ba`; four successive startup reservations returned 200, replay returned 409, anonymous request returned 401. These tests reserve startup records; they do not allocate VMs.
- Controller revision `portabase-confidential-controller-00022-79k` points to this deployment and has `PORTABASE_OPERATING_MODE=development`. Production website deployment remains `6ae10a3f5208a45fbdb6ed1e`.
- Rollback: restore only controller admission endpoint to `https://6ade48b63705dca0f83861da--portabase-dev.netlify.app/.netlify/functions/cloud-confidential-admission` and operating mode to production. Prior quota will again limit future startups.
- First two draft packages (`6ae12f4e434045cf9b817c53`, `6ae12fbae91edeafd996eab4`) failed dependency checks; neither was connected to the controller. Explicit prebundling fixed packaging.

Final browser confirmation passed after the idle helper restart: Development mode visible, original chassis and module layout preserved, source/destination settings collapsed, real project options populated, and Dropbox selection returns to the panel with no error. `/status` confirms source, destination and Dropbox connected, preflight passed, and both backupExecuted and restoreExecuted false. User working tab now points to port 58441, not sample preview port 4197.

Scope limit: this verifies restored panel interactions and existing provider grants. Fresh OAuth consent, S3 service-plane setup and complete backup/restore are not claimed as tested. No production website release, backup/restore execution, or Codex Cloud transfer occurred.
