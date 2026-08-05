# Portabase security & trust model

Public page: **https://portabase.dev/security** (also `/trust`).  
Deep customer explainer: **https://portabase.dev/security#keys-protected** · Cloud summary: **https://portabase.dev/cloud#keys**

## Up front (required honesty)

On **managed Cloud**, a runner must use encryption material to complete a job. That means **there is still a possibility that Portabase can see or use a key** during a run — especially on **Trust Portabase**, and still (under grant) when using **customer KMS**.

Controls (customer KMS, CloudTrail, CloudWatch, short job windows, revoke) **reduce and contain** that risk. They do **not** make vendor key access magically impossible.

If **zero** vendor path to key material is a hard requirement: use the **standalone open-source engine** on infrastructure only the customer operates.

## Principle

**Customers choose their trust posture.** Portabase always manages Cloud staging runners and writes capsules to **customer BYO storage**. Crypto and audit controls are **optional and combinable**.

Most users will not know KMS, CloudTrail, or CloudWatch. That is expected. The **default path is “Trust Portabase”** with plain-language setup — and with the honest key-visibility disclaimer above. Advanced options stay **visible** for assurance and for later tightening.

## Retroactive access (product rule)

| Record | Always collected? | Customer access without a special request? |
| --- | --- | --- |
| **Job history + CloudWatch-style job logs** | **Yes** — every managed Cloud run | **Yes** — **Account → CloudWatch live** (secret-scoped) within retention |
| **CloudTrail (customer AWS)** | When Trail is on and we act on **their** KMS/S3 | **Yes** — their AWS account; console **CloudTrail live** optional |
| **Capsule objects** | On successful jobs | **Yes** — in **their** vault |

### Honest limits (logs)

- CloudTrail cannot invent history if Trail was off.
- Job log retention is finite.
- Logs do not prove “we never saw a key.”

## Trust dial

| Posture | Crypto authority | Key visibility reality |
| --- | --- | --- |
| **Trust Portabase** | Portabase holds job encryption material | **We may see/use the key** for unattended ops — by design |
| **Customer KMS** | Customer CMK + revocable grant | Runner **uses** the key path during the job; customer can revoke; audit in their CloudTrail |
| **Maximum control** | KMS + CloudTrail + CloudWatch | Strongest containment — **still not “impossible to touch”** during a granted job |
| **Standalone OSS** | Customer only | No Portabase runner → no Portabase key path |

## Optional controls

| Control | What it does |
| --- | --- |
| **Trust Portabase** | Convenience; explicit operational trust |
| **Customer KMS CMK** | Authority in their account; revocable |
| **Customer CloudTrail** | Their API audit; CloudTrail live in console |
| **Job CloudWatch** | Secret-scoped live tail + retroactive history |

## Always true on Cloud

- Managed staging (no laptop required)
- BYO binary destination
- Control plane is not the recovery vault
- We stay honest about residual key visibility on managed jobs

## Related

- [LAUNCH-SCOPE.md](./LAUNCH-SCOPE.md)
- [OPEN_CORE.md](./OPEN_CORE.md)
- [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)
