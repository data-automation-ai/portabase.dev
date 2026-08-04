#Requires -Version 5.1
<#
.SYNOPSIS
  Binary backup TEST MODE — exercises the real binary upload/verify pipeline with tiny fixtures.

.DESCRIPTION
  99.9% of DR byte volume is binary. Full AMI/S3 copies take hours/days and hide pipeline bugs.
  This mode creates SMALL synthetic binary files, runs them through the same Dropbox (and optional
  S3) path as production, then downloads and checksum-verifies. Fail closed on any mismatch.

  Profiles:
    Tiny     - 64 KiB + 1 MiB + 8 MiB (default smoke; seconds)
    Medium   - Tiny + 64 MiB (minutes)
    DiskSim  - Medium + 1 GiB single blob (simulates "small disk image" without creating EBS)
    EbsSmoke - DiskSim PLUS optional real 1 GiB EBS volume → snapshot → cleanup (slow, costs ~$0.10)

  Opinion: use Tiny/Medium for every change; DiskSim before claiming large-file readiness;
  EbsSmoke rarely (proves AWS snapshot path, not needed for Dropbox transfer bugs).

.EXAMPLE
  .\scripts\test-binary-backup-mode.ps1
  .\scripts\test-binary-backup-mode.ps1 -Profile DiskSim
  .\scripts\test-binary-backup-mode.ps1 -Profile Tiny -AlsoS3
  .\scripts\test-binary-backup-mode.ps1 -Profile EbsSmoke -CreateEbsVolume
#>
param(
  [ValidateSet('Tiny', 'Medium', 'DiskSim', 'EbsSmoke')]
  [string]$Profile = 'Tiny',
  [string]$Region = 'us-east-1',
  [string]$DropboxRoot = 'AWS-Binary-Backups',
  [string]$ExportBucket = 'aws-binary-dr-exports-899867382621',
  [switch]$AlsoS3,
  [switch]$CreateEbsVolume,
  [switch]$KeepLocal,
  [string]$AccountId = ''
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Step([string]$Message) { Write-Host ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $Message) }

function Get-FileSha256([string]$Path) {
  (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLowerInvariant()
}

function New-DeterministicBinaryFile {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][long]$ByteLength,
    [Parameter(Mandatory)][string]$SeedLabel
  )
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }

  # Deterministic stream: seed from label, then repeat a 1 MiB pattern so re-runs match.
  $seedBytes = [System.Text.Encoding]::UTF8.GetBytes("portabase-binary-test|$SeedLabel|$ByteLength")
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $block = $sha.ComputeHash($seedBytes)
  $pattern = New-Object byte[] 1048576
  for ($i = 0; $i -lt $pattern.Length; $i += 32) {
    $copy = [Math]::Min(32, $pattern.Length - $i)
    [Array]::Copy($block, 0, $pattern, $i, $copy)
    $block = $sha.ComputeHash($block)
  }

  $fs = [System.IO.File]::Open($Path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
  try {
    $remaining = $ByteLength
    while ($remaining -gt 0) {
      $n = [int][Math]::Min($remaining, $pattern.Length)
      $fs.Write($pattern, 0, $n)
      $remaining -= $n
    }
  } finally {
    $fs.Dispose()
  }
}

function Get-ProfilePlan([string]$Name) {
  $files = @(
    @{ name = 'fixture-64kib.bin';  bytes = 64KB;  kind = 'tiny' },
    @{ name = 'fixture-1mib.bin';   bytes = 1MB;   kind = 'small' },
    @{ name = 'fixture-8mib.bin';   bytes = 8MB;   kind = 'chunk' }
  )
  if ($Name -in @('Medium', 'DiskSim', 'EbsSmoke')) {
    $files += @{ name = 'fixture-64mib.bin'; bytes = 64MB; kind = 'medium' }
  }
  if ($Name -in @('DiskSim', 'EbsSmoke')) {
    $files += @{ name = 'fixture-1gib-disk-sim.bin'; bytes = 1GB; kind = 'disk-sim' }
  }
  return $files
}

# ---- Identity / paths ----
if (-not $AccountId) {
  $AccountId = (aws sts get-caller-identity --query Account --output text 2>$null)
  if (-not $AccountId) { $AccountId = 'local' }
}
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$work = Join-Path $env:TEMP "portabase-binary-test-$stamp"
$fixtureDir = Join-Path $work 'fixtures'
$downloadDir = Join-Path $work 'download'
New-Item -ItemType Directory -Force -Path $fixtureDir, $downloadDir | Out-Null

$dropboxDest = "dropbox:$DropboxRoot/$AccountId/binary-test-mode/$Profile/$stamp"
$s3DestPrefix = "binary-test-mode/$Profile/$stamp"

Write-Step "Binary TEST MODE profile=$Profile account=$AccountId"
Write-Step "Work: $work"
Write-Step "Dropbox dest: /$DropboxRoot/$AccountId/binary-test-mode/$Profile/$stamp"

# ---- Build fixtures ----
$plan = Get-ProfilePlan $Profile
$manifest = [ordered]@{
  mode        = 'binary-test'
  profile     = $Profile
  accountId   = $AccountId
  startedAt   = (Get-Date).ToUniversalTime().ToString('o')
  dropboxPath = "/$DropboxRoot/$AccountId/binary-test-mode/$Profile/$stamp"
  s3Bucket    = if ($AlsoS3) { $ExportBucket } else { $null }
  files       = @()
  ebs         = $null
  result      = 'RUNNING'
}

foreach ($item in $plan) {
  $path = Join-Path $fixtureDir $item.name
  Write-Step ("Creating {0} ({1:N0} bytes, kind={2})..." -f $item.name, $item.bytes, $item.kind)
  New-DeterministicBinaryFile -Path $path -ByteLength ([long]$item.bytes) -SeedLabel $item.name
  $hash = Get-FileSha256 $path
  $manifest.files += [ordered]@{
    name      = $item.name
    kind      = $item.kind
    bytes     = $item.bytes
    sha256    = $hash
    localPath = $path
  }
  Write-Step ("  sha256={0}" -f $hash)
}

# ---- Optional real 1 GiB EBS volume smoke (rare) ----
if ($Profile -eq 'EbsSmoke' -and $CreateEbsVolume) {
  Write-Step 'EBS smoke: create 1 GiB volume, snapshot (most recent = this one), tag, then delete volume...'
  $az = (aws ec2 describe-availability-zones --region $Region --query 'AvailabilityZones[0].ZoneName' --output text)
  $volTags = 'ResourceType=volume,Tags=[{Key=Name,Value=portabase-binary-test},{Key=PortabaseBackup,Value=true},{Key=PortabaseTestMode,Value=true}]'
  $volId = aws ec2 create-volume --region $Region --availability-zone $az --size 1 --volume-type gp3 `
    --tag-specifications $volTags `
    --query VolumeId --output text
  Write-Step ("  volume={0} - waiting available..." -f $volId)
  aws ec2 wait volume-available --region $Region --volume-ids $volId
  $snapTags = "ResourceType=snapshot,Tags=[{Key=Name,Value=portabase-binary-test-$stamp},{Key=PortabaseBackup,Value=true},{Key=PortabaseTestMode,Value=true}]"
  $snapId = aws ec2 create-snapshot --region $Region --volume-id $volId `
    --description "Portabase binary test mode $stamp" `
    --tag-specifications $snapTags `
    --query SnapshotId --output text
  Write-Step ("  snapshot={0} - waiting completed (most recent test snapshot)..." -f $snapId)
  aws ec2 wait snapshot-completed --region $Region --snapshot-ids $snapId
  aws ec2 delete-volume --region $Region --volume-id $volId | Out-Null
  $manifest.ebs = [ordered]@{
    volumeId   = $volId
    snapshotId = $snapId
    sizeGiB    = 1
    az         = $az
    note       = 'Volume deleted after snapshot; snapshot retained with PortabaseTestMode=true (delete manually when done)'
  }
  Write-Step ("  volume deleted; snapshot {0} kept for inspection" -f $snapId)
} elseif ($Profile -eq 'EbsSmoke' -and -not $CreateEbsVolume) {
  Write-Step 'EbsSmoke without -CreateEbsVolume: using 1 GiB file only (recommended). Pass -CreateEbsVolume to also test AWS snapshot path.'
}

# ---- rclone config (same auth path as production binary export) ----
$bundle = aws secretsmanager get-secret-value --secret-id secrets-bundle --query SecretString --output text | ConvertFrom-Json
$tokenResp = Invoke-RestMethod -Method Post -Uri 'https://api.dropboxapi.com/oauth2/token' -Body @{
  grant_type    = 'refresh_token'
  refresh_token = $bundle.'dropbox-refresh-token'
  client_id     = $bundle.'dropbox-app-key'
  client_secret = $bundle.'dropbox-app-secret'
} -ContentType 'application/x-www-form-urlencoded'
$expiry = (Get-Date).ToUniversalTime().AddSeconds([int]$tokenResp.expires_in).ToString('o')
$tokenJson = (@{
  access_token  = $tokenResp.access_token
  token_type    = 'bearer'
  refresh_token = $bundle.'dropbox-refresh-token'
  expiry        = $expiry
} | ConvertTo-Json -Compress)

$confPath = Join-Path $work 'rclone.conf'
@(
  '[dropbox]'
  'type = dropbox'
  "client_id = $($bundle.'dropbox-app-key')"
  "client_secret = $($bundle.'dropbox-app-secret')"
  "token = $tokenJson"
  ''
  '[awss3]'
  'type = s3'
  'provider = AWS'
  'env_auth = true'
  "region = $Region"
  'acl = private'
) -join "`n" | Set-Content $confPath -Encoding utf8

$rclone = @(
  'C:\Users\ryanh\git\portabase.dev\desktop\vendor\rclone.exe',
  'C:\Users\ryanh\git\portabase.dev\release\win-unpacked\resources\tools\rclone.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $rclone) { throw 'rclone.exe not found' }

function Invoke-Rclone {
  param([Parameter(Mandatory)][string[]]$RcloneArgs)
  Write-Step ("rclone {0}" -f ($RcloneArgs -join ' '))
  & $rclone --config $confPath @RcloneArgs
  if ($LASTEXITCODE -ne 0) { throw "rclone failed ($LASTEXITCODE)" }
}

# ---- Upload fixtures to Dropbox ----
Write-Step 'Uploading binary fixtures to Dropbox (production path)...'
Invoke-Rclone -RcloneArgs @('copy', $fixtureDir, $dropboxDest, '--transfers', '4', '--checkers', '8', '--tpslimit', '8', '--progress')

# ---- Optional S3 ----
if ($AlsoS3) {
  Write-Step "Uploading binary fixtures to s3://$ExportBucket/$s3DestPrefix ..."
  Invoke-Rclone -RcloneArgs @('copy', $fixtureDir, "awss3:$ExportBucket/$s3DestPrefix", '--s3-no-check-bucket', '--progress')
}

# ---- Download + verify ----
Write-Step 'Downloading from Dropbox and verifying SHA-256...'
Invoke-Rclone -RcloneArgs @('copy', $dropboxDest, $downloadDir, '--transfers', '4', '--checkers', '8', '--tpslimit', '8', '--progress')

$failures = @()
foreach ($f in $manifest.files) {
  $gotPath = Join-Path $downloadDir $f.name
  if (-not (Test-Path $gotPath)) {
    $failures += "MISSING after download: $($f.name)"
    continue
  }
  $gotHash = Get-FileSha256 $gotPath
  $gotLen = (Get-Item $gotPath).Length
  if ($gotHash -ne $f.sha256) {
    $failures += "HASH MISMATCH $($f.name): expected $($f.sha256) got $gotHash"
  } elseif ($gotLen -ne $f.bytes) {
    $failures += "SIZE MISMATCH $($f.name): expected $($f.bytes) got $gotLen"
  } else {
    Write-Step ("  OK {0} sha256={1}" -f $f.name, $gotHash)
    $f.verified = $true
  }
}

$manifest.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
$manifest.result = if ($failures.Count -eq 0) { 'PASS' } else { 'FAIL' }
$manifest.failures = $failures

$manifestPath = Join-Path $work 'BINARY_TEST_MANIFEST.json'
($manifest | ConvertTo-Json -Depth 8) | Set-Content $manifestPath -Encoding utf8
Invoke-Rclone -RcloneArgs @('copy', $manifestPath, $dropboxDest, '--progress')

$readme = @(
  '# Portabase binary TEST MODE result'
  ''
  "- Profile: $Profile"
  "- Result: $($manifest.result)"
  "- Dropbox: $($manifest.dropboxPath)"
  "- Started: $($manifest.startedAt)"
  "- Finished: $($manifest.finishedAt)"
  ''
  'This is a pipeline smoke test with synthetic binaries — not a production DR snapshot.'
  'Production binary exports use export-aws-binary-backups-to-dropbox.ps1 without -TestMode.'
) -join "`n"
$readmePath = Join-Path $work 'README.md'
Set-Content $readmePath $readme -Encoding utf8
Invoke-Rclone -RcloneArgs @('copy', $readmePath, $dropboxDest, '--progress')

if (-not $KeepLocal) {
  # Keep only the manifest + any passphrase-like notes; fixtures are large for DiskSim
  if ($Profile -in @('DiskSim', 'EbsSmoke')) {
    Remove-Item $fixtureDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item $downloadDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

Write-Host ''
Write-Host '========================================'
Write-Host ("BINARY TEST MODE: {0}" -f $manifest.result)
Write-Host ("Dropbox: {0}" -f $manifest.dropboxPath)
if ($failures.Count) {
  $failures | ForEach-Object { Write-Host ("  FAIL: {0}" -f $_) }
  exit 2
}
Write-Host 'All synthetic binary fixtures uploaded, downloaded, and hash-verified.'
Write-Host '========================================'

[pscustomobject]@{
  result      = $manifest.result
  profile     = $Profile
  dropboxPath = $manifest.dropboxPath
  workDir     = $work
  fileCount   = $manifest.files.Count
  ebs         = $manifest.ebs
}
