# Generated 2026-08-04T18:01:44.1602638-04:00 — load source + target for E2E
# Usage: . .\scripts\load-e2e-env.ps1
Get-Content "$PSScriptRoot\..\.env.portabase.local" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  if ($_ -match '^([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
  }
}
Get-Content "$PSScriptRoot\..\.env.replay-target.local" | ForEach-Object {
  if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
  if ($_ -match '^([^=]+)=(.*)$') {
    [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
  }
}
Write-Host "E2E env loaded: source=$env:SUPABASE_PROJECT_REF target=$env:PORTABASE_TARGET_PROJECT_REF"
