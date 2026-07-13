# Offline license and copy-deterrence architecture

Electron is the interface, not the protection boundary. ASAR files can be unpacked and JavaScript obfuscation is not meaningful license enforcement.

## Intended paid-license design

1. Move trial-limit enforcement, capsule capture, and restore execution into a compiled Rust core shared by Windows, macOS, and Linux.
2. Generate an Ed25519 signing key pair once. Store the private key only in the PortaBase AWS `secrets-bundle`; embed only the public key in the native core.
3. After Square confirms a completed $147 Essentials order, mint a lifetime signed license containing a random license ID, edition, issue date, free-update entitlement, and reasonable device allowance.
4. Let the desktop app import the small license file and verify it entirely offline. No Supabase key, cloud credential, passphrase, capsule, machine inventory, or backup metadata is sent to PortaBase.
5. Enforce the indefinite trial limits inside the native core. A missing, altered, or incorrectly signed license remains trial edition. Paid licenses do not expire or become ineligible for future software versions.
6. Code-sign every platform binary and publish hashes. The app should distinguish an authentic PortaBase build from a modified redistribution.

## Customer-fair policy

- The purchased software keeps working offline even if PortaBase disappears.
- Every future PortaBase software update is included at no additional charge.
- License verification must never be on the backup critical path through a PortaBase server.
- Allow at least two customer-owned machines and a documented offline recovery process.
- A hardware change must not make an existing recovery capsule unreadable.
- The encryption passphrase and capsule format are independent of the commercial license.

## Release blocker

The current JavaScript reference engine and unsigned desktop installer prove functionality, not copy protection. Do not claim protected paid distribution until the native verifier, signing-key ceremony, Square fulfillment path, device policy, signed installers, and recovery tests are complete.
