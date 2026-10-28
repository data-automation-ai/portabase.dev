# Picker rescue — 2026-10-28

Signed: Codex `/root`, check-in 2026-10-28 12:27:07 UTC. Existing worktree `.worktrees/enclave-home-20261025`; branch `codex/enclave-copy-only-20261025`; no new worktree.

- Original full component: `src/console/database-scope-selector.jsx`. Source route repair: `c42c8c2`.
- Narrow artifact release implementation: `scripts/release-picker-rescue.mjs`, commits `fa01467` and `368850e`. This preserves published assets and all 37 backend functions, applying the source route repair to the published module graph.
- Published: `6ae1e92f86a13c701e2fe143`. Rollback: `6ae10a3f5208a45fbdb6ed1e`.
- Five public asset SHA-1 values matched the prepared release after publication.
- Browser verification used the exact corrected draft assets through the isolated localhost fixture in `scripts/preview-picker-rescue.mjs`. Two synthetic tables and two synthetic files; no customer account data changed. Filtering `alpha` showed only `alpha.png` after expanding its bucket; excluding it reduced included files from two to one. Filtering `accounts`, choosing structure-only, and clearing the filter preserved that choice and the independent file exclusion. Total changed from 5 MB to 3 MB.
- Initial draft `6ae1e892554ce969edb18315` introduced duplicate React runtimes because sibling chunks imported the original entry name. It was immediately rolled back after the browser exposed the error. Corrected release renames all four current JS chunks consistently and passed the browser fixture.
- Final public browser check timed out and disconnected; authenticated production picker behavior is not yet verified. The fixture proves UI interactions, not backup/restore execution or live OAuth discovery.
- Current full backup/restore runner was not started. The separate confidential scope adapter still exposes whole-bucket selection; this release restores the original full dashboard picker.
- Remaining untracked `AGENTS.mdx` is preserved. Ignored release stage `.portabase/picker-rescue` is approximately 2.15 MB and contains baseline/release manifests and asset bytes, no credentials. No cleanup performed.
- Next action: verify the signed-in public dashboard, then reconcile real selection persistence and backend transfer support independently. Preserve current rollback and worktrees.
