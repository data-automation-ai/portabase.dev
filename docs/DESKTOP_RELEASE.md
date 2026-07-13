# Desktop release procedure

## Windows

Install dependencies on the build machine, ensure PostgreSQL client tools are on `PATH`, then run `npm run desktop:win`. The staging script embeds the current platform's pinned Supabase CLI and PostgreSQL tools. Public distribution requires an Authenticode code-signing certificate. Verify the final installer with `Get-AuthenticodeSignature` and publish its SHA-256 hash.

The July 13, 2026 engineering build produced and smoke-launched `PortaBase-Setup-0.3.0-unsigned.exe` (SHA-256 `8A9CB79E405816B2BFB73E0C43BD31715CDFC7E4FDDC03074D8C55819D1C63A0`). Authenticode status is `NotSigned`; this is an engineering artifact, not a public release.

## macOS

On a macOS runner with PostgreSQL client tools available, run `npm run desktop:mac`. Configure an Apple Developer ID Application identity and notarization credentials in the protected CI environment. Verify the final DMG with `codesign --verify --deep --strict`, `spctl --assess --type execute`, and `xcrun stapler validate`. Do not advertise a DMG built without those checks.

## Linux

On the oldest supported Linux build image, install PostgreSQL client tools and a Secret Service implementation, then run `npm run desktop:linux`. Test both the Debian package and AppImage. The app refuses to persist secrets when Electron reports the insecure `basic_text` backend; command-scoped values may still be entered without persistence.

The July 13, 2026 EC2 clean build produced and package-smoke-tested:

- `PortaBase-0.3.0-x86_64.AppImage` — SHA-256 `869734B02B7A21190E3AB532E45D8DB527BBADBFF1D6BF189F0D88C5724CE5CB`
- `PortaBase-0.3.0-amd64.deb` — SHA-256 `6CF869162F2F3C76E9516B51DD7572FB39E731640BDAED20E52EB808DA6D19DF`

The AppImage was extracted without installation; its bundled PostgreSQL 16.14 and Supabase CLI 2.109.1 executables ran successfully. The Debian control record was verified as package `portabase` version `0.3.0`, with the expected maintainer, homepage, and runtime dependencies. A graphical clean-install and keyring acceptance pass remains required before public release.
