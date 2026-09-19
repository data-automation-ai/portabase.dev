# Provably zero-knowledge (capsule law)

**Non-negotiable.** Portabase Cloud and this website are **provably zero-knowledge** with respect to **capsule contents** and **customer sealing keys**.

Source of truth in code: `utility/zero-knowledge.mjs`.

## Forbidden on our site / Cloud APIs / dashboard / telemetry UI

- Viewing or listing **Storage object names** (or paths)
- Table/row contents, function source, schemas beyond non-identifying runner-allowlisted health aggregates
- Capsule plaintext, passphrase, wrapping keys, or any API that could return them
- Any UI that implies Portabase can open or inventory the capsule for the customer

## Allowed

- Capsule **management** metadata that does not reveal contents: capsule id, encrypted size totals, last success/fail, schedule, destination **type** (not object listing), plan GB usage
- Customer-side **key injection** into the seal (passphrase never POSTed to Portabase)
- Health telemetry graphs/gauges with **no object names**

## Architecture

| Rule | Meaning |
| --- | --- |
| Ciphertext-only echo | If Cloud stores or displays anything about a capsule, it is id / status / encrypted byte totals / timing — not names inside the archive |
| Runner-originated aggregates | Telemetry is opt-in health events the runner builds (`utility/telemetry.mjs`). Unknown / inventory keys are rejected |
| No server-side decrypt | There is no Cloud function that accepts a passphrase or returns plaintext. `hasServerDecryptPath() === false` |
| Client-side keys | Browser WebCrypto / CLI `PORTABASE_ENCRYPTION_PASSPHRASE` only |

## Honesty boundary (do not collapse these)

- **Control plane (this site + `/api/*`)** — provably ZK on contents and sealing keys. No peek API.
- **Managed runner job window** — a job may still *use* crypto on the runner. Residual visibility is documented on `/security`. That is **not** a dashboard inventory of object names.

Standalone CLI on customer infrastructure is the only posture with **no** Portabase process in the crypto path.

## Contrast: Live Supabase viewer

The **Live Supabase** console page (`/app/supabase-viewer`) lets the customer inspect **their live project** with credentials they paste in the browser. That is a different trust model: they chose to point the tab at Supabase. Portabase still does **not** proxy those reads or receive the keys.

It does **not** lift the capsule rule. Capsule object names and plaintext stay invisible to Cloud.

## Related

- `docs/TELEMETRY_SCHEMA.md`
- `docs/CLOUD_CONSOLE.md`
- `docs/SECURITY-TRUST.md`
- `src/lib/telemetry-view.js` · `src/lib/capsule-inspect.js`
