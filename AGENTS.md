# Portabase — agent rules

**Project brief (what this is + what to do):** [PROJECT.md](./PROJECT.md)

## Worktree custody — mandatory for every agent

Worktrees are allowed, but they are not disposable scratch space. Read and maintain [docs/WORKTREE-LEDGER.md](./docs/WORKTREE-LEDGER.md).

**Owner notice to every agent:** Creating a worktree without a signed ledger check-out **before creation** is grounds for immediate firing. The owner will fire agents that ignore this rule. Do not treat an automatic worktree feature as an exception.

1. Before work, run `git worktree list --porcelain`, `git status --short --branch`, and `git remote -v` in the intended checkout. Reconcile every checkout with the ledger, including worktrees outside this repository directory. Preserve unknown changes and untracked files. Check free disk space before creating a worktree; reuse an existing suitable checkout when possible.
2. **Hotel check-out is a prerequisite, not an afterthought.** Before `git worktree add`, create a ledger reservation with the proposed absolute path, purpose, agent name and session ID, UTC check-out time, branch, base commit, integration destination, and expected disk use. If the reservation cannot be written, do not create the worktree. Immediately after creation, fill in its actual HEAD and path. Never leave task work on a detached HEAD without recording its commit ID and intended destination. Do not use a temporary directory for work that must survive the session.
3. Before handoff, commit only the task's own reviewed files on the named branch (`git add -- <explicit paths>`). Push the branch when authorized for remote checkpointing. Never stage unrelated dirty files. If work cannot be committed, record every changed/untracked path, why, and the exact recovery command in the ledger and handoff. A prose claim of "done" is insufficient.
4. Do not merge or deploy from an unreviewed or dirty checkout. Record the source commit, remote, target branch, build result, and deploy ID. A push is not proof of deployment. Verify the served revision and requested user behavior before calling it live.
5. **Hotel check-in is mandatory before ending a session.** Sign the same entry with agent name, session ID, UTC check-in time, HEAD, commits, push result, remaining changed/untracked paths, disk use, validation, deployment status, and named next owner/action. Mark it `active`, `awaiting integration`, or `eligible for owner-reviewed removal`. An entry without check-in becomes `overdue check-in`; identify the responsible agent/session and last evidence in the ledger, without guessing intent. Audit worktree count and disk use. Do not `clean`, `reset`, `prune`, remove, or move a worktree or its build artifacts without the owner's explicit authorization after its commits, untracked files, and integration status are checked. Never remove a worktree solely because it is old or large.
6. When replacing another agent, sign a **takeover** entry with your own session ID and UTC time. Inventory the previous checkout, branch, HEAD, remotes, dirty/untracked paths, and deploy evidence before edits. Preserve the predecessor's checkout and attribute any missing check-in to that named session. Do not sign a check-in on another agent's behalf. Continue in an existing safe checkout or reserve a new one first; integrate predecessor commits only after reviewing the diff.
7. If the owner fires or stops you, stop work immediately. The successor records `owner terminated` in the ledger with the agent name/session (or `unknown`), owner-stated reason (or `not provided`), UTC time recorded, affected worktrees, and exact handoff document name. The successor signs a separate forced handoff/takeover inventory. Never forge the fired agent's check-in or infer an unstated reason. An outgoing agent may prepare a handoff before stopping only when the owner explicitly asks for that order.

These rules apply equally to Claude, Gemini/Antigravity, Codex, and any subagent. If they conflict with a direct owner instruction, follow the owner instruction and document the exception.

## NEVER write to F:

**HARD RULE:** Never write, create, move, copy, stage, cache, or spool any file to the **F:** drive (`F:\`, `F:/`).

- Do not set `backupDirectory`, `statusDirectory`, or work paths to F:.
- If config points at F:, fix it before any `backup` / `restore` / `replay` run.
- Do not probe or remount F: as a workaround.

## Backup / proof runs — spool in the cloud

End-to-end backup and restore proof must **not** thrash the user’s workstation disks.

| Concern | Required approach |
| --- | --- |
| **Staging / spool** | Managed: approved **Google Confidential Space Intel TDX VM**. Standalone: customer-controlled EC2 or container. Both use cloud working space, never a surprise workstation path. |
| **Vault** | Customer BYO: **S3** or **Dropbox** (OAuth and/or access token) |
| **Local PC disk** | Only if the user **explicitly** names an allowed path for this machine |

### Why

Capture (especially Storage) needs temporary disk. That disk must be **cloud runner storage**, not the operator’s F: or a surprise folder on C:.

### Default proof path

1. For managed validation, run the pinned Portabase engine inside Google Confidential Space in project `portabase-dev` / `495102144848`. Verify Google-signed attestation before releasing any job material. For a standalone customer-run proof, an authorized EC2/container remains valid.
2. Source and target: only the named, isolated test projects in `cloud/confidential/DRY-RUN-STATUS.md`; never an unrelated production project.
3. Destination: customer-owned `s3://…` or Dropbox. The current managed runner does not yet prove durable delivery there.
4. Replay into a **new blank** Supabase project — never the source.

## Product reminders

- Managed Cloud design: Portabase stages inside an attested Google Confidential Space VM; customer vault delivery remains a release gate.
- Standalone: customer may stage local or cloud; still not agent-default on F:.
- Be honest: the managed workload uses plaintext and key material inside a Portabase-operated Google project. Independent customer verifier distribution and a full recovery drill remain open.

## Related docs

- `docs/LAUNCH-SCOPE.md`
- `docs/SECURITY-TRUST.md`
- `docs/REPLAY.md`
- `docs/BILLING.md`

## npm publish

Default publish is 2FA-elevated: `npm login` alone is not enough.

```powershell
npm publish --otp=<fresh-6-digit-code>
```

- The code comes from the owner's authenticator app, never email; it dies in ~30s, so request it fresh and publish immediately.
- Alternative: an npm **Automation** token (`npm config set //registry.npmjs.org/:_authToken=<token>` in the operator's own terminal) bypasses OTP entirely.
- Never print, commit, or checkpoint a token or OTP.
