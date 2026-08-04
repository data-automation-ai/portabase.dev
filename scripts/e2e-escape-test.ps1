# Portabase E2E escape test — source ops project → S3 → whitepaper destination
# Does NOT use F:. Capsules under ./portabase-capsules then AWS S3.
#
# Usage:
#   .\scripts\e2e-escape-test.ps1                 # doctor + plan only
#   .\scripts\e2e-escape-test.ps1 -Trial          # small trial escape → S3
#   .\scripts\e2e-escape-test.ps1 -Full           # full escape (heavy — prefer EC2)
#   .\scripts\e2e-escape-test.ps1 -Trial -Replay  # trial + replay to whitepaper (blank target required)
#
# Env files (gitignored, from secrets-bundle):
#   .env.portabase.local       source = ekklokrukxmqlahtonnc
#   .env.replay-target.local   target = kiuwcdpjsdotkoojbkoi (redshift whitepaper)

param(
  [switch]$Trial,
  [switch]$Full,
  [switch]$Replay,
  [switch]$DoctorOnly
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

function Load-EnvFile([string]$Path) {
  if (-not (Test-Path $Path)) { throw "Missing $Path — regenerate from secrets-bundle" }
  Get-Content $Path | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -match '^\s*$') { return }
    if ($_ -match '^([^=]+)=(.*)$') {
      [Environment]::SetEnvironmentVariable($Matches[1].Trim(), $Matches[2].Trim(), 'Process')
    }
  }
}

Write-Host "=== Portabase E2E escape setup ===" -ForegroundColor Cyan
Load-EnvFile (Join-Path $Root '.env.portabase.local')
Load-EnvFile (Join-Path $Root '.env.replay-target.local')

$src = $env:SUPABASE_PROJECT_REF
$tgt = $env:PORTABASE_TARGET_PROJECT_REF
$bucket = 'dataautomation-ai-backups'
$prefix = "portabase/$src"

Write-Host "Source:      $src"
Write-Host "Target:      $tgt (whitepaper)"
Write-Host "Vault:       s3://$bucket/$prefix/"
Write-Host "Passphrase:  env PORTABASE_ENCRYPTION_PASSPHRASE set=$([bool]$env:PORTABASE_ENCRYPTION_PASSPHRASE)"

if ($src -eq $tgt) { throw 'Source and target project refs must differ.' }

Write-Host "`n--- doctor ---" -ForegroundColor Cyan
node utility/portabase.mjs doctor
if ($LASTEXITCODE -ne 0) { throw "doctor failed exit=$LASTEXITCODE" }

Write-Host "`n--- plan ---" -ForegroundColor Cyan
node utility/portabase.mjs plan
if ($LASTEXITCODE -ne 0) { throw "plan failed exit=$LASTEXITCODE" }

if ($DoctorOnly -or (-not $Trial -and -not $Full)) {
  Write-Host "`nReady. Re-run with -Trial (recommended first) or -Full." -ForegroundColor Green
  Write-Host "  .\scripts\e2e-escape-test.ps1 -Trial"
  Write-Host "  .\scripts\e2e-escape-test.ps1 -Trial -Replay   # requires blank whitepaper project"
  exit 0
}

if ($Full -and $Trial) { throw 'Pick -Trial or -Full, not both.' }

$mode = if ($Trial) { 'trial' } else { 'full' }
Write-Host "`n--- escape ($mode) → S3 ---" -ForegroundColor Cyan
if ($Trial) {
  node utility/portabase.mjs backup --trial
} else {
  Write-Host "WARNING: full capture can be multi-GB. Prefer EC2 if Storage is large." -ForegroundColor Yellow
  node utility/portabase.mjs backup
}
if ($LASTEXITCODE -ne 0) { throw "escape failed exit=$LASTEXITCODE" }

# Locate newest capsule dir
$capRoot = Join-Path $Root 'portabase-capsules'
$latest = Get-ChildItem $capRoot -Directory -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -notlike '.*' -and $_.Name -like "$src-*" } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
if (-not $latest) { throw "No capsule directory found under $capRoot" }
Write-Host "Capsule: $($latest.FullName)"
Write-Host "S3:      s3://$bucket/$prefix/$($latest.Name)/"

if (-not $Replay) {
  Write-Host "`nEscape to vault complete. Replay when target is blank:" -ForegroundColor Green
  Write-Host "  .\scripts\e2e-escape-test.ps1 -Trial -Replay"
  Write-Host "  # or manually:"
  Write-Host "  node utility/portabase.mjs replay --capsule `"$($latest.FullName)`" --confirm-target $tgt"
  exit 0
}

Write-Host "`n--- replay → whitepaper ($tgt) ---" -ForegroundColor Cyan
Write-Host "Refuses if target has app tables/users/buckets/functions."
node utility/portabase.mjs replay --capsule $latest.FullName --confirm-target $tgt
if ($LASTEXITCODE -ne 0) { throw "replay failed exit=$LASTEXITCODE" }
Write-Host "`nE2E complete." -ForegroundColor Green
