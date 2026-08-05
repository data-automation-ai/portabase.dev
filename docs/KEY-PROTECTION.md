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
