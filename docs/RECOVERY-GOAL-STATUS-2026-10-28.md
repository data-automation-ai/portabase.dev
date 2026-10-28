# Recovery goal status — 2026-10-28 UTC

Scope: user /goal for the connected helper at http://127.0.0.1:58441/.
Overall: INCOMPLETE. No capture or restore started in this repair run.

| Capability | Source | Provisioned | Configured | Deployed | Live proof | Security proof | Status | Blocker |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Development recovery quota exception | e19db37, release cbd8304 | Existing isolated identity | Exact development owner only | Draft 6ae1615a5c7b97c3f70b72d0; controller 00023-blf | Two backup admissions returned 200; no jobs started | Replay 409, anonymous 401; production/other-owner unit checks | Verified admission | Actual recovery pending |
| Source and destination grants | Existing helper | Both existing grants | Real projects selected | Loopback 58441 | 18 source projects, 2 target projects; checks/preflight passed | Nonce/origin checks retained | Connected | Fresh account reconsent not tested |
| Mapping safety | project-mapping.mjs; execute-dry-run.mjs | Existing runner | All mappings required and authorized; unique targets; no selected source as target | Loopback helper | Selected DataAutomation to portabase shown | Missing/duplicate/unauthorized mapping tests; all batch targets prechecked before capture | Implemented and focused-tested | Multi-project recovery not live-tested |
| Overwrite safety | execute-dry-run.mjs | Existing runner | Explicit submitted consent; cannot bypass failed readiness | Loopback helper | No writes attempted | Negative tests cover all four modes | Implemented and focused-tested | Exact target/overwrite confirmation pending |
| Database picker | scope-modal.jsx; database-scope-selector.jsx | Existing live inventory | postgres > Schema > Object type > Object name; separate buckets | Served bundle | Actual public TABLE group, columns, Cancel checked; earlier Save & Close round trip succeeded | Unsupported database names rejected; scope route auth retained | Connected UI verified in part | Final repeat Save check interrupted by browser detachment |
| Pipe and arrows | machine-visual.mjs; enclave-chassis-svg.mjs | Existing UI | Vertical pipe attached to machine; small rightward arrows only during transfer | Loopback helper | Idle pipe screenshot reviewed; label width corrected afterward | Phase-driven focused checks | Implemented | Active animation awaits actual transfer; label final screenshot pending |
| Account identification | dry-run-gui.mjs | Existing grants | Operator confirmation labeled as such; unavailable email explained | Loopback helper | Honest operator-confirmed label visible | No fabricated provider email | Implemented | Supabase connection response does not supply account email |
| Single-project recovery and restored data | Existing managed engine | Google Confidential Space runner | Source and proposed target below | Not executed | Target inspected blank; source inventory measured | Attestation passed; no local data staging | BLOCKED | User confirmation and target capacity answer |
| Homepage certificate | weekly-research-20261027 worktree | Original screenshot | After Stories; public identifiers retained | Local preview 5178 only | Desktop preview inspected; build passed | Image reviewed: no passwords/tokens/private keys visible | Prepared, unpublished | Mobile preview and public deployment not claimed |

## Exact recovery confirmation outstanding

- Source: DataAutomation, project ekklokrukxmqlahtonnc, database postgres.
- Proposed destination: portabase, project wunfzvzguqlnxhtxipen, database postgres.
- Confirm overwrite of selected destination objects. The user requested exact confirmation before execution; pending asynchronous question has not been answered.
- Source preflight: database 2,617,570,095 bytes, Storage 10,499,815,221 bytes; 723 application tables, 151 Auth users, 17,391 Storage objects, 78 functions. Selected inventory: 718 tables and 17 buckets. Physical database size differs from selected table estimates.
- Target preflight: 11,005,075 database bytes, no application tables, Auth users, Storage objects or functions; blank=true.
- Destination billing/capacity cannot be verified with the source operator credential (provider returned 403). Ask whether this target has sufficient paid capacity or use a user-approved smaller scope. Do not purchase or upgrade.
- No prior unrelated synthetic target authorization is treated as permission to overwrite this destination.

## Runtime and rollback

- Source worktree: confidential-12gb-20261025; original root checkout preserved.
- Controller: portabase-confidential-controller, portabase-dev / 495102144848, us-central1.
- Admission endpoint: https://6ae1615a5c7b97c3f70b72d0--portabase-dev.netlify.app/.netlify/functions/cloud-confidential-admission.
- Controller revision: portabase-confidential-controller-00023-blf, ready.
- Admission rollback: restore prior endpoint https://6ae13026e2b5d043da3537ba--portabase-dev.netlify.app/.netlify/functions/cloud-confidential-admission. This reinstates recovery quota; prior controller revision 00022-79k.
- Public homepage deployment remains 6ae10a3f5208a45fbdb6ed1e. Certificate section is not publicly deployed.
- Helper restarts were performed only while idle; encrypted grants and selected scope retained, no job automatically started.
- Recovery staging remains cloud-only. No F: writes, workstation data staging, or Codex Cloud transfer.

## Limits that remain explicit

Supabase integration supports postgres; additional/standalone databases are not implemented merely by displaying a database name. Storage selection is whole-bucket. S3, fresh OAuth consent, multi-project recovery, complete recovery, restored application behavior and durable vault delivery have not been proved by this repair. Passing focused tests/builds is not end-to-end proof. Browser debugger intermittently detaches; do not infer success from a timed-out interaction.

Certificate source: original codex-clipboard-EPwbs7.png, copied unchanged to public/evidence/portabase-live-attestation.png. No genuine secret was visible to redact. Public IPs, hashes, key fingerprint and project identifiers remain visible as requested. The caption distinguishes attestation from independent audit or successful recovery.
