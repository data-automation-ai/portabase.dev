# Desktop release procedure

**Launch scope: Windows 11 only.** Do not build or advertise a Mac desktop app. macOS/Linux operators use the open-source CLI (`utility/portabase.mjs`).

## Windows 11 (only supported desktop package)

Build on a **Windows 11 x64** machine (not Mac). Install dependencies, ensure PostgreSQL client tools are on `PATH`, then run:

```powershell
npm run desktop:win
```

The staging script embeds the pinned Supabase CLI and PostgreSQL tools. Public distribution requires an Authenticode code-signing certificate. Verify the final installer with `Get-AuthenticodeSignature` and publish its SHA-256 hash.

- Artifact: `release/Portabase-Setup-<version>-unsigned.exe`
- Packaged app refuses non-`win32` platforms at startup.

Historical engineering note (July 13, 2026): `Portabase-Setup-0.3.1-unsigned.exe` (SHA-256 `44BF6FD0A89892A427D141B429E323239E9BF9CEE475359AEC2C203F84676C4C`) was an unsigned smoke build, not a public release.

## macOS / Linux desktop

**Out of launch scope.** `npm run desktop:mac` and `npm run desktop:linux` exit with an error on purpose. Use the CLI on those OSes.
