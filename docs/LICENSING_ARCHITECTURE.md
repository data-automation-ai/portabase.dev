# Offline license and copy-deterrence architecture

Electron is the interface, not the protection boundary. ASAR files can be unpacked and JavaScript obfuscation is not meaningful license enforcement.

## Implemented paid-license design

1. PortaBase has an Ed25519 signing key pair. The private key is held in the PortaBase AWS `secrets-bundle`, with an encrypted Netlify function environment fallback; only the public key ships with the application.
2. After Square confirms a completed $147 Essentials order, `/api/license/claim` atomically binds the order to the customer's selected platform and mints a lifetime signed license with free future updates.
3. The desktop app imports the small license file and verifies it entirely offline. No Supabase key, cloud credential, passphrase, capsule, machine inventory, or backup metadata is sent to PortaBase.
4. Missing, malformed, altered, or wrong-platform licenses fail closed to the indefinite trial limits. Emergency restore is never disabled by a commercial-license check.
5. A customer can retain and reuse the same license file on customer-owned machines for its selected platform; the purchase is not coupled to a PortaBase login service.

## Hardening still required

1. Move trial-limit enforcement, capsule capture, and restore execution into a compiled Rust core shared by Windows, macOS, and Linux. The current JavaScript/ASAR implementation deters casual copying but can be patched by a determined attacker.
2. Code-sign every platform binary and publish hashes. macOS additionally requires Developer ID signing, notarization, and ticket stapling.
3. Complete controlled Square sandbox and live-purchase/refund acceptance tests before enabling public checkout.

## Customer-fair policy

- The purchased software keeps working offline even if PortaBase disappears.
- Every future PortaBase software update is included at no additional charge.
- License verification must never be on the backup critical path through a PortaBase server.
- Allow at least two customer-owned machines and a documented offline recovery process.
- A hardware change must not make an existing recovery capsule unreadable.
- The encryption passphrase and capsule format are independent of the commercial license.

## Public-release blocker

Signed offline fulfillment is implemented, but the installers remain unsigned and the recovery acceptance suite has not yet completed a live write-and-verify restore into a new disposable Supabase account. Do not claim a signed production release or proven one-click disaster recovery until those gates pass. Do not describe the JavaScript implementation as unbreakable copy protection.
