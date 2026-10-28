# Graphical dashboard recovery evidence

Owner requirement: preserve the advanced source-left / destination-right graphical screen with the object picker integrated into the center machine. Do not substitute the vertical OneTwoThreeDone screen.

## Verified regression

- Commit `c42c8c2` replaced `EnclaveDashboard` with `OneTwoThreeDone` in `src/console/ConsoleApp.jsx` and removed the graphical dashboard background.
- The release script `scripts/release-picker-rescue.mjs` applied that replacement to published bundles. Its recorded published deploy is `6ae1e92f86a13c701e2fe143`.
- On 2026-10-28 the owner's live browser at `/dashboard` displayed the vertical OneTwoThreeDone screen. This is a confirmed presentation regression, not evidence that the graphical source files were deleted.
- The original scene remains in `cloud/confidential/dry-run-gui.mjs` and `machine-visual.mjs`; original picker integration remains in `scope-modal.jsx`, `scope-ui-model.mjs`, and `src/console/database-scope-selector.jsx`.
- The hosted `enclave-dashboard.jsx` wrapper has hardcoded connection, inventory, capacity and attestation values. Its `dangerouslySetInnerHTML` does not run the picker script. Merely switching the route back is insufficient and must not be represented as a working restoration.

## This morning's destination work

Commit `5ff1e05` survives in the local dashboard branch and the locally recorded `origin/main` history. It includes destination provisioned capacity, database/Storage usage, auto-growth increments and ceiling, capacity warnings, a spending warning, and the inspection code in `supabase-access.mjs`. Copies also survive in the root and confidential-12gb worktree.

The exact separate free-MB field and wording "if want to extend" have not been located. Do not report those specific controls as recovered without evidence. Some old inspection defaults infer auto-growth settings rather than receiving them from the provider; that is not verified account configuration.

## Recovery preview

`node scripts/preview-graphical-recovery.mjs` serves the original graphical renderer and saved original picker bundle at `http://127.0.0.1:58453`. It uses synthetic inventory, blocks provider operations, and does not launch runners or backups. Scope changes affect only fixture memory.

The browser confirmed Source on the left, Destination on the right, central enclave graphics, and the integrated Select database objects button. The browser bridge detached before the requested screenshot and picker-open verification completed. No authenticated user data was changed. No application repair or live deployment is claimed.

## Required release gate for the restoration

1. Keep one canonical graphical dashboard entry and an approved full-screen reference. A separate selector is not equivalent to the integrated screen.
2. Browser checks must cover the entire graph, opening/filtering/saving/reopening the picker, independent source/destination selection, destination capacity/used/free information, and extension behavior.
3. Reconnection and refresh checks must preserve project mappings, object choices and active mode. Connection errors must retain the view and last-known values with an explicit stale indication; never replace them with starter data.
4. Preserve selection state by authenticated account and project; never persist credentials as part of UI-state recovery. Do not auto-retry capture/restore submissions without idempotency and verified job state.
5. Test the exact built commit and deployed route, not just a picker fixture. Record source commit, artifact identity, previous deploy and rollback. Do not call a release successful without checking the signed-in graphical screen.

Next action: finish confirming the exact original interface with the owner, restore its hosted integration without synthetic status, then implement and pass the release gate before deployment. The existing live version has not been changed by this session.

## Implemented restoration checkpoint (2026-10-28T14:04:19.8048118Z)

The dashboard now uses EnclaveDashboard with the original graphical renderer, an isolated style boundary, and the original DatabaseScopeSelector mounted in a stable dialog inside that screen. Production-shaped discovery supplies projects and objects; hardcoded source/destination, inventory, capacity and attestation were removed. Account-scoped choices are saved in localStorage and full inventories in IndexedDB. Failed discovery preserves last-known workspace data. Source and destination OAuth use separate PKCE/session cookies, renewable encrypted sessions, and popup completion without replacing the main view. The destination panel reports capacity, usage and estimated free MB plus the provider settings link; missing auto-growth readings stay unknown.

Browser fixture verification: source-left < machine < destination-right; table accounts set to structure-only and file alpha.png excluded independently; selected total 5 MB -> 3 MB; save/reopen and successful refresh retained both choices; simulated failed refresh retained choices and target reading; a fresh browser tab and reload retained 3 MB, target selection, 8,192 MB capacity, 1,024 MB DB used, and 7,168 MB estimated free. Fixed a partial-cache migration crash and flushed modal state before opening to avoid displaying an empty prior draft. Browser checks use synthetic data and do not prove a backup/restore or authenticated cloud job.

Validation: 27 focused tests passed across graphical state/route contract, OAuth slots and renewal, original GUI rendering, scope mapping and machine visuals. Build passed before final refinements; release preparation rebuilds from an archived exact commit. Narrow release script preserves the homepage and unrelated published artifacts/functions; only the dashboard/app routes and cloud-oauth function are replaced. Deployment result will be recorded after publication.

Deployment preservation correction: adding global function environment variables invalidated reuse of all 37 published functions. Those three task-created variables were removed after storing and verifying the registered OAuth configuration as an authenticated encrypted record in the private portabase-hosted-oauth Blobs store. The OAuth function loads this record with the site's existing Blobs credentials. No credential values are in Git or public assets. Existing unrelated function environments remain unchanged. Reconfigure this record when the site's Blobs credential rotates. Original incomplete draft 6ae2016f726774ae1431b645 is retained, unpublished.
