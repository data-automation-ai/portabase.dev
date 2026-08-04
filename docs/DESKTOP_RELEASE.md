# Desktop release procedure

## Windows

Install dependencies on the build machine, ensure PostgreSQL client tools are on `PATH`, then run `npm run desktop:win`. The staging script embeds the current platform's pinned Supabase CLI and PostgreSQL tools. Public distribution requires an Authenticode code-signing certificate. Verify the final installer with `Get-AuthenticodeSignature` and publish its SHA-256 hash.

The July 13, 2026 post-drill engineering build produced `Portabase-Setup-0.3.1-unsigned.exe` (SHA-256 `44BF6FD0A89892A427D141B429E323239E9BF9CEE475359AEC2C203F84676C4C`). Its bundled PostgreSQL 18.4 and Supabase CLI 2.109.1 executables ran successfully. Authenticode status is `NotSigned`; this is an engineering artifact, not a public release.

## macOS

On a macOS runner with PostgreSQL client tools available, run `npm run desktop:mac`. Configure an Apple Developer ID Application identity and notarization credentials in the protected CI environment. Verify the final DMG with `codesign --verify --deep --strict`, `spctl --assess --type execute`, and `xcrun stapler validate`. Do not advertise a DMG built without those checks.

## Linux

On the oldest supported Linux build image, install PostgreSQL client tools and a Secret Service implementation, then run `npm run desktop:linux`. Test both the Debian package and AppImage. The app refuses to persist secrets when Electron reports the insecure `basic_text` backend; command-scoped values may still be entered without persistence.

The July 13, 2026 EC2 clean build produced and package-smoke-tested:

- `Portabase-0.3.1-x86_64.AppImage` — SHA-256 `70A0C5DECFC9BE41045704DD52CEB2683D2020AA04295000D40D7AC4C7FA4DEB`
- `Portabase-0.3.1-amd64.deb` — SHA-256 `1472101BDE82A932FC2CDCB9086FDABE5B1BAA85FFAF823B55BA0BBB561B7545`

The AppImage was extracted without installation; its bundled PostgreSQL 16.14 and Supabase CLI 2.109.1 executables ran successfully, and the packaged tools contained no dependency symlinks back to the builder. The Debian control record was verified as package `portabase` version `0.3.1`, with the expected maintainer, homepage, and runtime dependencies. A graphical clean-install and keyring acceptance pass remains required before public release.
