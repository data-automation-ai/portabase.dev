# PortaBase code-signing and notarization runbook

The engineering artifacts are intentionally unsigned. Never rename an unsigned build to hide that fact. A public release must be rebuilt on the target operating system with protected signing credentials, must fail when signing is unavailable, and must publish a SHA-256 checksum beside the download.

## Windows

Choose one signing route:

1. **Azure Trusted Signing**: create the Trusted Signing account and certificate profile, give the CI service principal the Certificate Profile Signer role, and configure electron-builder `win.azureSignOptions` plus short-lived Azure workload credentials.
2. **CA-issued Authenticode certificate**: obtain an organization-validation or EV code-signing certificate. Configure electron-builder `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD`, or use a hardware-backed provider through a custom SignTool integration. Do not commit a PFX/P12 file or password.

For the release build, set electron-builder `forceCodeSigning: true`; without that gate, a missing credential can silently produce an unsigned installer. Sign both the application executables and NSIS installer with SHA-256 and a trusted RFC 3161 timestamp. Microsoft requires explicit file- and timestamp-digest algorithms in current SignTool versions.

Verify on a clean Windows VM:

```powershell
Get-AuthenticodeSignature .\PortaBase-Setup-0.3.0.exe | Format-List Status,StatusMessage,SignerCertificate,TimeStamperCertificate
signtool verify /pa /v .\PortaBase-Setup-0.3.0.exe
```

The required outcome is `Valid`/exit code zero, the expected PortaBase publisher identity, a valid timestamp, and a successful install/uninstall. See [Microsoft SignTool](https://learn.microsoft.com/windows/win32/seccrypto/signtool), [Microsoft signature verification](https://learn.microsoft.com/windows/win32/seccrypto/using-signtool-to-verify-a-file-signature), and [electron-builder Windows signing](https://www.electron.build/docs/features/code-signing/code-signing-win/).

## macOS DMG and ZIP

1. Enroll the legal publisher in the Apple Developer Program.
2. Create a **Developer ID Application** certificate for direct distribution. Export it to a password-protected P12 only when CI requires it; otherwise use a dedicated build Mac keychain.
3. Inject `CSC_LINK` and `CSC_KEY_PASSWORD` from protected CI secrets. Inject Apple notarization credentials using an App Store Connect API key or the supported Apple ID/app-specific-password flow. Do not store any of them in this repository.
4. Build on macOS with hardened runtime enabled and signing required.
5. Submit the DMG/ZIP with `notarytool`, wait for an accepted result, review the notarization log, and staple the ticket to the DMG.

Verify on a clean current macOS machine:

```bash
codesign --verify --deep --strict --verbose=2 "PortaBase.app"
spctl --assess --type execute --verbose=4 "PortaBase.app"
xcrun stapler validate "PortaBase-0.3.0.dmg"
```

Apple requires Developer ID signing and notarization for modern direct distribution; `notarytool` and `stapler` are the supported command-line tools. See [Apple Developer ID](https://developer.apple.com/support/developer-id/), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution), and [electron-builder macOS signing](https://www.electron.build/docs/features/code-signing/code-signing-mac/).

## Linux

AppImage does not have a Windows/macOS-style platform trust prompt. Publish its SHA-256 checksum over HTTPS and optionally publish a detached GPG signature from a protected release key. If PortaBase later operates an APT repository, sign repository metadata and packages as part of that repository workflow. Do not call a checksum a code signature.

## Secret handling

- Store certificate material, passwords, Apple API keys, and cloud-signing credentials in the CI provider or AWS Secrets Manager—not `.env`, Git, release ZIPs, or the application bundle.
- Give the signing job access only to the release commit and output artifacts.
- Require human approval for the production-signing environment.
- Retain the signed artifact, checksum, signer identity, timestamp/notarization evidence, source commit, dependency lockfile, and clean-machine acceptance result as one release record.
- Revoke and rotate immediately if a signing credential may have escaped.

## Current blocker

No PortaBase publisher certificate, Azure Trusted Signing profile, Apple Developer ID identity, or Apple notarization credential has been supplied to this workspace. The current Windows artifact is therefore correctly labeled `unsigned`; the Linux artifacts have verified hashes but no GPG signature; a public macOS DMG cannot be produced from Windows or Linux.
