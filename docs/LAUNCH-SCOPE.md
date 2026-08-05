# Portabase launch scope — Supabase only

**v1 product focus:** Supabase projects.

| In scope | Out of scope (for now) |
|----------|-------------------------|
| Supabase DB, Auth inventory, Storage objects, Edge Functions | Firebase / other BaaS |
| Supabase Auth for Cloud login (email + Google) | AWS Cognito Cloud login (code reserved, UI off) |
| Square $17/mo · ≤12 agents · BYO **capsule destination** | Portabase-hosted long-term object storage (vault) |
| **Cloud: Portabase stages on managed runners** | Requiring the customer’s laptop disk for Cloud staging |
| Standalone script: stage on local **or** customer cloud temp | Multi-cloud *product* identity at launch |
| **Desktop installer: Windows 11 only** | Mac desktop app / DMG (use open-source CLI on macOS) |

## Commercial split (non-negotiable)

### Portabase Cloud (sold service)

Customers buy a **managed recovery ops service**. They expect **staging to be performed by Portabase** — not on their personal C: drive.

| Concern | Cloud responsibility |
|---------|----------------------|
| Capture + stage + encrypt | **Portabase managed runners** (isolated per workspace) |
| Long-term capsule storage | **Customer BYO destination** (their S3 / Drive / etc.) |
| Console, trial, alerts, agents | Portabase control plane |
| Passphrase / source keys | Customer-supplied secrets to the runner path; **not** stored as capsule plaintext in the product DB |
| Laptop disk | **Not required** for Cloud |

Staging is ephemeral runner workspace. After the capsule is verified on the customer destination, runner workspace is discarded. Portabase does **not** sell “we keep your recovery bytes forever.”

### Standalone / open-source engine

The public CLI/script is for self-operators. **Staging is flexible:**

- Local disk / NAS on their machine, **or**
- Their own cloud storage / VM disk as the working area

They still choose the final **destination** for the encrypted capsule. The script may be extended so stage and destination are both cloud-side without a laptop.

## Why

Ship one clear deal: *keep Supabase, remove lockout SPOF*. Cloud sells **managed staging + ops**; BYO vault keeps trust and cost honest.

## Re-enable AWS Cloud identity later

In `src/lib/cloud-versions.js`:

```js
export const AWS_CLOUD_VERSION_ENABLED = true;
```

Cognito helpers and Terraform remain under `src/lib/cognito.js` and `aws/cloud/terraform/`.

## Customer AWS for capsules

Customers use **S3 / CFN recovery vault** as *their* binary **destination** — that is not “run the job on my laptop.” Cloud runners may write into that vault on their behalf.
