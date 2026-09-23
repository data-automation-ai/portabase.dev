# Contributing to Portabase

Thank you for helping. This repo is **open core**: the Escape engine is Apache-2.0. Portabase Cloud (billing, hosted console, managed runners) lives in the same tree but is not what most contributions should touch first.

## Before you start

1. Read the [README](README.md) and [docs/OPEN_CORE.md](docs/OPEN_CORE.md).
2. For engine work, [docs/ESSENTIALS_RUNBOOK.md](docs/ESSENTIALS_RUNBOOK.md) and [docs/REPLAY.md](docs/REPLAY.md).
3. Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

**Security bugs:** email escape@portabase.dev — see [SECURITY.md](SECURITY.md). Do not open a public issue.

## What we want

- Engine: capture, encrypt, verify, restore, replay, manifests, restore-plans
- Tests for those paths
- Docs that stay honest (COMPLETE / PARTIAL / FAILED; no fake “done”)
- Accessibility and clarity on the public site **when** it matches shipped behavior

## What to treat carefully

- Anything that claims Cloud can never see a key (it can, during a managed job)
- Restoring into a **source** project
- Secrets, `.env*.local`, capsules, terraform state — never commit these
- Marketing copy that outruns the engine

## Dev setup

```bash
npm install
npm test
npm run portabase -- doctor
```

Node 20+. Some restore tests need `psql` / `pg_dump` if you run live drills; unit tests in `utility/*.test.mjs` and `tests/` should pass without a live Supabase.

## Pull requests

- One change per PR when you can
- Add or update a test if you touch `utility/`
- Keep `src/lib/product.js` and `netlify/shared/product.mjs` in sync if you change prices or SMS rules
- Use the PR template
- Do not force-push shared branches

## Issues

Use the bug or feature templates. Include: OS, Node version, command, whether this is Community or Cloud, and a redacted log. Never paste `service_role` keys or passphrases.

## License

Contributions are under the [Apache License 2.0](LICENSE).
