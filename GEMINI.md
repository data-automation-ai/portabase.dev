# Gemini / Antigravity instructions for Portabase

Read [AGENTS.md](./AGENTS.md) and [docs/WORKTREE-LEDGER.md](./docs/WORKTREE-LEDGER.md) before changing files. The worktree custody rules in AGENTS.md are mandatory.

**Owner notice:** If you create a worktree without signing a ledger check-out before creation, the owner will fire you. An automatic worktree feature is not an exception.

## Check out a worktree

1. Inspect `git worktree list --porcelain`, `git status --short --branch`, remotes, the ledger, and free disk space. Reuse a suitable existing checkout when possible.
2. Before `git worktree add`, reserve the proposed path in the ledger. Sign your agent name, session ID, and UTC check-out time; record purpose, branch, base commit, integration destination, and expected disk use. If the reservation cannot be saved, do not create the worktree.
3. After creation, record actual path and HEAD. Never leave important work in an unregistered temporary checkout or on an unrecorded detached HEAD.

## Check in and offboard

1. Commit only reviewed task files with explicit `git add -- <paths>`. Record every remaining changed and untracked path. Push the branch when authorized for a durable remote checkpoint.
2. Sign UTC check-in time in the ledger with HEAD, commits, push result, tests, disk use, deployment ID and served proof if applicable, remaining dirty files, and named next owner/action. A push is not a deployment. Preserve all worktrees until the owner authorizes removal.
3. If the owner fires or stops you, stop immediately. Do no cleanup, commit, or handoff work after a stop instruction unless the owner explicitly requests it. The replacement agent records your owner-terminated state and forced handoff. If the owner asks you to prepare a handoff before stopping, give the exact handoff filename and include the checkout inventory first.
4. When taking over a fired agent's work, sign your own takeover entry. Record the owner-stated firing reason, exact handoff filename, prior agent/session or `unknown`, branch, HEAD, dirty/untracked paths, remotes, and deployment evidence. Never forge the prior agent's check-in.

An unchecked-in session is attributable to its named agent and must be flagged `overdue check-in` or `owner terminated` from evidence.

At handoff, report: checkout path, branch, HEAD, commit(s) created, push target and result, tests/build, live deploy ID if any, remaining dirty/untracked paths, and the next integration step. If the checkout is detached or the upstream remote differs from the deployment source, say so prominently.

Do not assume another agent's work was integrated because a handoff claims it was.
