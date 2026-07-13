# Desktop release procedure

## Windows

Install dependencies on the build machine, ensure PostgreSQL client tools are on `PATH`, then run `npm run desktop:win`. The staging script embeds the current platform's pinned Supabase CLI and PostgreSQL tools. Public distribution requires an Authenticode code-signing certificate. Verify the final installer with `Get-AuthenticodeSignature` and publish its SHA-256 hash.

The July 13, 2026 engineering build produced and smoke-launched `release/PortaBase-Setup-0.2.0-unsigned.exe`. It is intentionally named `unsigned` and is not a public release.

## macOS

On a macOS runner with PostgreSQL client tools available, run `npm run desktop:mac`. Configure an Apple Developer ID Application identity and notarization credentials in the protected CI environment. Verify the final DMG with `codesign --verify --deep --strict`, `spctl --assess --type execute`, and `xcrun stapler validate`. Do not advertise a DMG built without those checks.

## Linux

On the oldest supported Linux build image, install PostgreSQL client tools and a Secret Service implementation, then run `npm run desktop:linux`. Test both the Debian package and AppImage. The app refuses to persist secrets when Electron reports the insecure `basic_text` backend; command-scoped values may still be entered without persistence.
