#Requires -Version 5.1
<#
.SYNOPSIS
  Export critical AWS DIGITAL BINARY backups to Dropbox (not inventory JSON).

.DESCRIPTION
  Policy:
  - Always take the MOST RECENT completed EBS/AMI backup for each critical workload.
  - Sync existing S3 backup buckets (real binary dumps) to Dropbox cloud-to-cloud.
  - Store latest AMI images into S3 via CreateStoreImageTask, then copy to Dropbox.
  - Export secrets-bundle as an AES-encrypted archive (values included, encrypted at rest in Dropbox).

  Does NOT stage multi-hundred-GB files on the local C: drive (uses rclone S3->Dropbox).

  TEST MODE (-TestMode):
  Almost all byte volume in production is binary. Use -TestMode to run the same Dropbox/S3
  transfer + SHA-256 verify path against tiny synthetic binaries (or DiskSim 1 GiB file)
  without exporting real AMIs/dumps. See scripts/test-binary-backup-mode.ps1.
#>
param(
  [string]$Region = 'us-east-1',
  [string]$ExportBucket = 'aws-binary-dr-exports-899867382621',
  [string]$DropboxRoot = 'AWS-Binary-Backups',
  [switch]$SkipAmiExport,
  [switch]$SkipS3Sync,
  [switch]$SkipSecrets,
  [switch]$TestMode,
  [ValidateSet('Tiny', 'Medium', 'DiskSim', 'EbsSmoke')]
  [string]$TestProfile = 'Tiny',
  [switch]$TestAlsoS3,
  [switch]$TestCreateEbsVolume
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# ---- Binary test mode: full pipeline, tiny (or 1 GiB sim) outputs ----
if ($TestMode) {
  $testScript = Join-Path $PSScriptRoot 'test-binary-backup-mode.ps1'
  if (-not (Test-Path $testScript)) { throw "Missing $testScript" }
  $args = @{
    Profile      = $TestProfile
    Region       = $Region
    DropboxRoot  = $DropboxRoot
    ExportBucket = $ExportBucket
  }
  if ($TestAlsoS3) { $args.AlsoS3 = $true }
  if ($TestCreateEbsVolume) { $args.CreateEbsVolume = $true }
  Write-Host "TEST MODE: synthetic binary fixtures only (profile=$TestProfile). Production dumps/AMIs are skipped."
  & $testScript @args
  exit $LASTEXITCODE
}

$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$accountId = (aws sts get-caller-identity --query Account --output text)
$work = Join-Path $env:TEMP "aws-binary-dr-$stamp"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$manifestPath = Join-Path $work 'BINARY_MANIFEST.json'

# Critical S3 buckets that already hold digital binary backups
$s3BackupBuckets = @(
  'capece-supabase-backups',
  'dbasebackups',
  'dataautomation-emergency-backups',
  'dataautomation-ai-backups',
  'capece-backup-deploy-899867382621'
)

# ---- Dropbox + S3 rclone config ----
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
  param([Parameter(Mandatory = $true)][string[]]$RcloneArgs)
  Write-Host ("rclone {0}" -f ($RcloneArgs -join ' '))
  & $script:rclone --config $script:confPath @RcloneArgs
  if ($LASTEXITCODE -ne 0) { throw "rclone failed ($LASTEXITCODE): $($RcloneArgs -join ' ')" }
}

$manifest = [ordered]@{
  accountId   = $accountId
  startedAt   = (Get-Date).ToUniversalTime().ToString('o')
  policy      = 'most_recent_binary_only'
  dropboxRoot = "/$DropboxRoot/$accountId/$stamp"
  amiExports  = @()
  s3Syncs     = @()
  secrets     = $null
  notes       = @(
    'Binary digital backups (S3 dump objects + most-recent AMI images).',
    'Not a JSON inventory. Secret values only inside encrypted secrets archive.'
  )
}

# ---- 1) Most recent AMIs for critical instances → S3 store-image-task ----
if (-not $SkipAmiExport) {
  Write-Host 'Resolving MOST RECENT completed AMIs for critical workloads...'
  $images = aws ec2 describe-images --owners self --region $Region --output json | ConvertFrom-Json
  $criticalNamePrefixes = @('capece-daily-', 'combo-auto-')
  $latestAmis = foreach ($prefix in $criticalNamePrefixes) {
    $match = $images.Images |
      Where-Object { $_.Name -like "$prefix*" -and $_.State -eq 'available' -and $_.RootDeviceType -eq 'ebs' } |
      Sort-Object { [datetime]$_.CreationDate } -Descending |
      Select-Object -First 1
    if ($match) { $match }
  }

  foreach ($ami in $latestAmis) {
    Write-Host ("StoreImageTask MOST RECENT: {0} ({1}) created {2}" -f $ami.ImageId, $ami.Name, $ami.CreationDate)
    $task = aws ec2 create-store-image-task --region $Region --image-id $ami.ImageId --bucket $ExportBucket --output json 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Warning ("create-store-image-task failed for {0}: {1}" -f $ami.ImageId, $task)
      $manifest.amiExports += [ordered]@{
        imageId = $ami.ImageId
        name    = $ami.Name
        status  = 'FAILED_START'
        error   = "$task"
      }
      continue
    }
    $taskObj = $task | ConvertFrom-Json
    $manifest.amiExports += [ordered]@{
      imageId     = $ami.ImageId
      name        = $ami.Name
      creationDate = $ami.CreationDate
      snapshotId  = $ami.BlockDeviceMappings[0].Ebs.SnapshotId
      objectKey   = $taskObj.ObjectKey
      s3Bucket    = $ExportBucket
      status      = 'InProgress'
      policy      = 'most_recent'
    }
  }
}

# ---- 2) Sync S3 binary backup buckets → Dropbox (cloud-to-cloud) ----
if (-not $SkipS3Sync) {
  foreach ($bucket in $s3BackupBuckets) {
    $dest = "dropbox:$DropboxRoot/$accountId/$stamp/s3-binary/$bucket"
    Write-Host "Syncing binary S3 backup bucket s3://$bucket -> $dest"
    try {
      Invoke-Rclone -RcloneArgs @('copy', "awss3:$bucket", $dest, '--s3-no-check-bucket', '--fast-list', '--transfers', '8', '--checkers', '16', '--progress')
      $manifest.s3Syncs += [ordered]@{ bucket = $bucket; dest = "/$DropboxRoot/$accountId/$stamp/s3-binary/$bucket"; status = 'copied' }
    } catch {
      Write-Warning $_
      $manifest.s3Syncs += [ordered]@{ bucket = $bucket; dest = "/$DropboxRoot/$accountId/$stamp/s3-binary/$bucket"; status = 'error'; error = "$_" }
    }
  }
}

# ---- 3) Encrypted secrets-bundle binary ----
if (-not $SkipSecrets) {
  Write-Host 'Exporting secrets-bundle as encrypted binary archive...'
  $secretJson = aws secretsmanager get-secret-value --secret-id secrets-bundle --query SecretString --output text
  $plain = Join-Path $work 'secrets-bundle.json'
  $secretJson | Set-Content -Path $plain -Encoding utf8
  # passphrase from random + store only the encrypted blob; passphrase printed once to local file not uploaded
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $pass = [Convert]::ToBase64String($bytes)
  $passFile = Join-Path $work 'SECRETS_ARCHIVE_PASSPHRASE.txt'
  @"
Passphrase for secrets-bundle.aes.zip (KEEP OFF DROPBOX / print and store offline):
$pass
"@ | Set-Content $passFile -Encoding utf8

  # Compress then AES via .NET
  $zipPlain = Join-Path $work 'secrets-bundle.zip'
  if (Test-Path $zipPlain) { Remove-Item $zipPlain -Force }
  Compress-Archive -Path $plain -DestinationPath $zipPlain
  $aesOut = Join-Path $work 'secrets-bundle.aes'
  $plainBytes = [IO.File]::ReadAllBytes($zipPlain)
  $salt = New-Object byte[] 16
  $iv = New-Object byte[] 16
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($salt)
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($iv)
  $derive = New-Object System.Security.Cryptography.Rfc2898DeriveBytes($pass, $salt, 200000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
  $key = $derive.GetBytes(32)
  $aes = [System.Security.Cryptography.Aes]::Create()
  $aes.Key = $key
  $aes.IV = $iv
  $aes.Mode = [System.Security.Cryptography.CipherMode]::CBC
  $aes.Padding = [System.Security.Cryptography.PaddingMode]::PKCS7
  $enc = $aes.CreateEncryptor().TransformFinalBlock($plainBytes, 0, $plainBytes.Length)
  $packed = New-Object byte[] ($salt.Length + $iv.Length + $enc.Length)
  [Array]::Copy($salt, 0, $packed, 0, 16)
  [Array]::Copy($iv, 0, $packed, 16, 16)
  [Array]::Copy($enc, 0, $packed, 32, $enc.Length)
  [IO.File]::WriteAllBytes($aesOut, $packed)
  Remove-Item $plain, $zipPlain -Force

  Invoke-Rclone -RcloneArgs @('copy', $aesOut, "dropbox:$DropboxRoot/$accountId/$stamp/secrets/", '--progress')
  $manifest.secrets = [ordered]@{
    dropboxObject = "/$DropboxRoot/$accountId/$stamp/secrets/secrets-bundle.aes"
    encryption    = 'AES-256-CBC PBKDF2-SHA256 200k'
    passphrase    = 'LOCAL ONLY - see SECRETS_ARCHIVE_PASSPHRASE.txt on this machine under TEMP work dir (not uploaded)'
    localPassFile = $passFile
  }
}

# ---- 4) Wait briefly and copy any completed AMI objects already in S3 ----
if (-not $SkipAmiExport -and $manifest.amiExports.Count -gt 0) {
  Write-Host 'Polling store-image tasks (AMI binary export can take a long time for 100-400GB)...'
  for ($i = 0; $i -lt 30; $i++) {
    $tasks = aws ec2 describe-store-image-tasks --region $Region --output json | ConvertFrom-Json
    $active = @($tasks.StoreImageTaskResults | Where-Object { $_.StoreTaskState -in @('InProgress', 'Pending') })
    $completed = @($tasks.StoreImageTaskResults | Where-Object { $_.StoreTaskState -eq 'Completed' })
    Write-Host ("  store-image: completed={0} active={1}" -f $completed.Count, $active.Count)
    if ($active.Count -eq 0 -and $completed.Count -gt 0) { break }
    if ($i -eq 0 -or ($i % 3) -eq 0) {
      # copy whatever completed so far
      foreach ($t in $completed) {
        $key = $t.AmiId + '.bin'
        if ($t.S3objectKey) { $key = $t.S3objectKey }
        Write-Host "  copying completed AMI object $key to Dropbox..."
        Invoke-Rclone -RcloneArgs @('copy', "awss3:$ExportBucket/$key", "dropbox:$DropboxRoot/$accountId/$stamp/ami-images/", '--s3-no-check-bucket', '--progress')
      }
    }
    Start-Sleep -Seconds 60
  }
  # Final pass copy all .bin objects for this export bucket prefix
  Write-Host 'Syncing AMI export bucket objects to Dropbox (may continue after script if still InProgress)...'
  Invoke-Rclone -RcloneArgs @('copy', "awss3:$ExportBucket", "dropbox:$DropboxRoot/$accountId/$stamp/ami-images/", '--s3-no-check-bucket', '--include', '*.bin', '--progress')
}

$manifest.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
($manifest | ConvertTo-Json -Depth 8) | Set-Content $manifestPath -Encoding utf8
Invoke-Rclone -RcloneArgs @('copy', $manifestPath, "dropbox:$DropboxRoot/$accountId/$stamp/", '--progress')

# README
$readme = @(
  '# AWS binary digital backups'
  ''
  "- Account: $accountId"
  "- Stamp: $stamp"
  '- Policy: MOST RECENT AMI/EBS image per critical workload; full sync of S3 binary backup buckets.'
  ''
  '## Contents'
  '- s3-binary/  - real dump objects from backup buckets'
  '- ami-images/ - CreateStoreImageTask outputs for latest capece-daily + combo-auto AMIs (large)'
  '- secrets/secrets-bundle.aes - encrypted secrets archive (passphrase NOT in Dropbox)'
  ''
  '## Passphrase'
  'SECRETS_ARCHIVE_PASSPHRASE.txt is only on the machine that ran the export under TEMP. Print offline.'
) -join "`n"
$readmePath = Join-Path $work 'README.md'
Set-Content $readmePath $readme -Encoding utf8
Invoke-Rclone -RcloneArgs @('copy', $readmePath, "dropbox:$DropboxRoot/$accountId/$stamp/", '--progress')

Write-Host ''
Write-Host "Binary DR upload root: /$DropboxRoot/$accountId/$stamp/"
Write-Host "Secrets passphrase file (local only): $passFile"
Write-Host 'If AMI store tasks still InProgress, re-run with -SkipS3Sync -SkipSecrets later to finish ami-images sync.'

[pscustomobject]@{
  dropboxRoot = "/$DropboxRoot/$accountId/$stamp"
  workDir     = $work
  passFile    = $passFile
  amiTasks    = $manifest.amiExports
}
