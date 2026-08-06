# Key protection — open-source source of truth

**Public security explainer:** https://portabase.dev/security#keys-protected  

**Crypto source (Apache-2.0):** [`utility/capsule-crypto.mjs`](../utility/capsule-crypto.mjs)

Portabase does **not** hide capsule encryption in a closed Cloud binary. The Escape capsule is sealed with code you can read, pin, and run offline.

## Module map

| Concern | Open-source file |
| --- | --- |
| **AES-256-GCM encrypt / decrypt, scrypt KDF, passphrase rules** | `utility/capsule-crypto.mjs` |
| Re-exports + rest of engine | `utility/portabase-core.mjs` |
| CLI job orchestration (`backup` / `verify` / `restore` / `replay`) | `utility/portabase.mjs` |
| Telemetry denylist (reject secret-shaped fields) | `utility/telemetry.mjs` |
| Unit tests for wrong passphrase / auth tag | `utility/portabase.test.mjs` |

## Algorithm (customer summary)

1. Passphrase must be ≥ **16** characters (`PORTABASE_ENCRYPTION_PASSPHRASE`).
2. **scrypt** derives a 32-byte key (`N=32768`, `r=8`, `p=1`, random 16-byte salt).
3. **AES-256-GCM** encrypts the payload (12-byte IV, AAD = capsule id).
4. SHA-256 of plaintext and ciphertext is stored in `capsule.json` metadata.
5. Decrypt verifies ciphertext hash → GCM auth tag → plaintext hash (fail closed).

Format id: `portabase-aes256gcm-v1`.

## What stays out of this module (by design)

- Cloud console login / Square billing  
- How managed runners inject secrets for unattended schedules (ops posture — see Security page honesty)  
- Your S3/Dropbox credentials  

Those are **not** substitutes for the open crypto path above.

## Verify locally

```powershell
npm test
# includes: encrypted capsules authenticate and reject the wrong passphrase
```

```powershell
node -e "import { capsuleCryptoPublicDescription } from './utility/capsule-crypto.mjs'; console.log(capsuleCryptoPublicDescription())"
```

## Cloud vs OSS

| Path | Who runs crypto |
| --- | --- |
| Standalone CLI | **Your** process; only this open-source code |
| Portabase Cloud managed runner | Same **open-source** encrypt/decrypt; runner must hold material for the job window |

If zero Portabase key path is required: use standalone only.

---

## Supabase source credentials (separate from capsule passphrase)

Customers often say “keys” when they mean the **Supabase service-role / secret key**, DB URL, or Management API token.
Those open the **live** project for capture/restore. They are **not** the AES passphrase and alone cannot open a sealed `.pbase`.

### Storage

| Path | Where Supabase credentials live |
| --- | --- |
| Standalone | Env / OS secret store on **customer** runner only |
| Cloud managed | Workspace-scoped secrets path for the job; encrypted at rest; not plaintext in marketing/analytics |
| Cloud + customer KMS | Material unwrap under a CMK the customer owns; revocable grant to runner role |

**Never stored as:** plaintext in SMS/email/telemetry, browser localStorage as long-term vault, default “share with support” payloads, or as Portabase’s only recovery copy.

### Runtime fortifications

1. Injected for the **job window** on the managed runner — not painted into every console screen  
2. Ephemeral staging disk; durable artifact = sealed capsule in **customer** vault  
3. Separation of duties: source keys ≠ passphrase ≠ vault IAM ≠ console login ≠ SMS route  
4. Guarded restore targets a **new/blank** project by design  
5. Agent/API tokens are hashed/scoped — not a substitute for the Supabase service-role  

### Logging (always on for managed jobs)

| Event | Customer-visible later | Secret body in log? |
| --- | --- | --- |
| Job start/finish/fail | Timestamps, status, error **class** | No — redacted / rejected |
| Layer completion | DB / Auth / Storage / Functions outcome | No |
| Credential attach/rotate/remove | Who + when (workspace audit) | Event only |
| Supabase auth failure during job | Failure class | No |
| CloudWatch-style job tail | Scoped stream in console | Redaction of secret-shaped fields |
| Telemetry health | Status / RPO / missed window | Denylist rejects secret-shaped fields |
| Customer CloudTrail (optional) | `kms:*`, vault `s3:PutObject` in **their** AWS | Customer-owned retention |

Telemetry denylist implementation: `utility/telemetry.mjs`. CloudWatch redaction: `netlify/functions/cloud-cloudwatch-live.mjs`.

### Alerting

- Job failed (including credential-looking failures) → SMS / email / webhook  
- Missed escape window / silence → multi-person chain  
- Verify / integrity failure → escalate; partial stays partial  
- Audit of who changed Supabase bindings  
- Optional: customer AWS alarms on unexpected KMS/vault principals  

### Hard requirement: zero Portabase custody of Supabase keys

Run **standalone OSS only**. Cloud is optional ops, not a gate on Escape.
