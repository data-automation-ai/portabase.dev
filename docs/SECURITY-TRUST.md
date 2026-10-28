# Security and trust: Secure Enclave recovery

Updated 2026-10-28. This document describes the managed implementation and its trust boundaries. Source code and local tests are not proof of a deployed workflow or a completed customer recovery drill. Consult the release evidence and the actual session attestation before declaring a capability live.

## Managed execution

Portabase operates the Google Cloud project `portabase-dev` (project number `495102144848`). Managed jobs run in Google Confidential Space on Intel TDX Confidential VMs. The configuration enables secure boot, vTPM and integrity monitoring, pins the Confidential Space boot image and immutable application container digest, disables serial output and workload log redirection, and bounds runner lifetime. Debugging and SSH are not an advertised customer tunnel.

Plaintext source data, provider credentials and recovery key material exist inside the running workload. Hardware-encrypted memory protects a specific boundary; it does not mean Portabase has no operational responsibility or that the application is incapable of disclosure. Source/provider APIs and customer vaults remain separate trust dependencies.

## Verification before key release

`cloud/confidential/attestation.mjs` checks Google’s signature using a fixed Google JWKS endpoint, expected issuer and audience, token freshness, the caller’s random challenge, approved project, Intel TDX hardware, secure boot, disabled debugging, Confidential Space support attributes, immutable container digest, expected entry point, restart policy and absence of command/environment overrides.

The attested nonce binds the challenge and the enclave public-key fingerprint. The session identifier is validated and bound inside the encrypted command; it is not itself a claim in the attestation token. Commands use RSA-OAEP-256 plus A256GCM JWE; replies use the caller’s response key. Session ownership, expiration, one-use offers and encrypted challenge binding prevent ordinary cross-customer command reuse.

The hosted browser verifier and its approved release policy are distributed by Portabase. An independently distributed, independently pinned verifier is an additional control, not an already-completed guarantee. Operators control release policy and future code. Attestation identifies code; it does not audit that code.

Google references: [Confidential Space security](https://docs.cloud.google.com/docs/security/confidential-space) and [attestation token claims](https://docs.cloud.google.com/confidential-computing/confidential-space/docs/reference/token-claims?hl=en). A downloadable “attestation certificate” is a presentation of Google-signed OIDC evidence, not a TLS certificate or an external audit certificate.

## Recovery keys and encrypted state

Customer recovery keys protect encrypted connection profiles and recovery data. They must remain available independently of a runner restart. They are not the VM’s temporary hardware memory-encryption key.

Capsules use AES-256-GCM. Managed manifests and binary catalogs use authenticated encryption with purpose-separated HKDF-derived keys. Cipher parameters may be visible; user manifest content remains ciphertext. The catalog and retained object versions reside in the configured customer vault and are loaded on later launches. A missing or unauthenticated catalog is not silently accepted as a verified baseline.

The $9 policy pays for the initial binary baseline, then transfers new or changed binary objects. Selected database content is captured in full each run. This is not database incremental replication. Retention must preserve all versions referenced by recovery manifests. Encryption does not prevent a vault owner or compromised provider credential from deleting recovery material.

## Control plane and usage

The account control plane holds account, billing, connection and job metadata. Hosted OAuth authorization backends receive plaintext provider grants before the attested handoff. Supabase grants use encrypted cookies; the legacy Dropbox flow uses a raw JSON HttpOnly cookie, so not every grant has the same at-rest protection. They do not receive the recovery key through the hosted grant bridge. The bridge verifies the pinned Google attestation before encrypting a fixed provider-import command to the enclave key. Raw grants are never returned to browser JavaScript by that bridge.

Usage receipts require a dedicated attestation audience and payload-bound nonce. The general attestation endpoint cannot authorize fabricated usage. Reservations and completion are durable, compare-and-swap protected, cumulative and idempotent. Customer-selected identifiers cannot reset the initial binary exemption. Fixed 30-day windows are anchored on the first metered job; an entire job is attributed to the window in which it starts. This differs from calendar-month or invoice-period billing.

Actual VM uptime is read from Google Compute monitoring and shown separately from job duration. Monitoring has a reporting delay. Missing observations and missing history must remain unknown, never invented zeroes or verified success.

## Optional keep-alive delegation

Free destination beacons are opt-in and run on a 72-hour cadence. They perform an authorized read-only activity query; this may reduce inactivity pauses but cannot guarantee provider availability or prevent suspension or termination.

Unattended beacons have a separate destination grant, protected by Google Cloud KMS and IAM. They do not use the recovery key or capsule plaintext. The OAuth grant may have broader provider privileges than the query the worker executes; this is not a database-enforced read-only grant. Revocation disables the delegation, and provider access can also be revoked. Separate beacon receipts and failures must remain visible. Unconfigured delegation or worker infrastructure must fail closed.

## Limits and validation

An upload, encrypted file, successful capture or matching subset does not prove a full recovery. Omitted tables, buckets and objects remain excluded. Verification must report its actual scope. A complete restore drill into a fresh, separate Supabase project is additional evidence and cannot be implied from UI fixtures or local unit tests.

Application flaws, browser compromise, malicious extensions, key loss, source-provider compromise, vault deletion, denial of service, operator release authority and hardware/vendor risks remain relevant. There is no claim of a finished independent audit, universally operator-resistant trust or a completed full customer recovery drill.

The Apache-2.0 standalone CLI is the alternative for customers operating their own host and credentials. It does not require a Portabase subscription. Customers remain responsible for infrastructure, provider charges, scheduling, retained keys and recovery testing.
