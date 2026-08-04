#Requires -Version 5.1
<#
.SYNOPSIS
  Easy interactive binary backup export to Dropbox - pick and confirm what ships.

.DESCRIPTION
  Most DR bytes are binary dumps and disk images. This script:
  1. Scans known S3 backup buckets and self-owned AMIs
  2. Groups related backups into "series" (e.g. nightly dumps for one project)
  3. Defaults to ONLY the MOST RECENT object per series
  4. Opens a visual picker (Out-GridView) so you multi-select/deselect rows
  5. Prints a clear confirmation list and waits for Y/N
  6. Copies only the confirmed binaries to Dropbox

  No huge inventory JSON. No silent export of every historical backup.

.EXAMPLE
  .\scripts\export-binary-backups-interactive.ps1
  .\scripts\export-binary-backups-interactive.ps1 -IncludeAllInSeries   # show history; still pick most recent yourself
  .\scripts\export-binary-backups-interactive.ps1 -AlsoAmiImages
  .\scripts\export-binary-backups-interactive.ps1 -WhatIf
#>
param(
  [string]$Region = 'us-east-1',
  [string]$DropboxRoot = 'AWS-Binary-Backups',
  [string]$ExportBucket = 'aws-binary-dr-exports-899867382621',
  [string[]]$Buckets = @(
    'capece-supabase-backups',
    'dbasebackups',
    'dataautomation-emergency-backups',
    'capece-backup-deploy-899867382621'
  ),
  [switch]$IncludeAiBackups,          # huge object counts; opt-in
  [switch]$IncludeAllInSeries,        # list every file in series (default: only latest)
  [ValidateSet('CriticalRolling', 'Packages', 'AllFiles')]
  [string]$PickerMode = 'CriticalRolling',
  # CriticalRolling = dumps/baks/sql nightly-style series only (easiest, most recent each)
  # Packages        = whole backup folders as one pickable unit (most recent package set)
  # AllFiles        = every object collapsed to most-recent-per-series (noisy)
  [switch]$AlsoAmiImages,             # offer most-recent AMI .bin exports (large)
  [switch]$SkipDropbox,               # discovery + confirm only
  [switch]$WhatIf,
  [switch]$ListOnly                   # print default (most-recent) selection; no GUI / no upload
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Banner([string]$Text) {
  Write-Host ''
  Write-Host ('=' * 72) -ForegroundColor Cyan
  Write-Host "  $Text" -ForegroundColor Cyan
  Write-Host ('=' * 72) -ForegroundColor Cyan
}

function Write-Info([string]$Text) { Write-Host "  $Text" -ForegroundColor Gray }
function Write-Ok([string]$Text) { Write-Host "  OK  $Text" -ForegroundColor Green }
function Write-WarnLine([string]$Text) { Write-Host "  !!  $Text" -ForegroundColor Yellow }

function Get-SeriesKey {
  param([string]$Bucket, [string]$Key)
  # Strip date-ish tokens so "nightly/db-20260731-0700.dump" and "nightly/db-20260801-0700.dump" share a series.
  $base = $Key -replace '\\', '/'
  $series = $base
  $series = $series -replace '\d{8}T\d{6}Z', '{DATE}'
  $series = $series -replace '\d{8}[_-]\d{4,6}', '{DATE}'
  $series = $series -replace '\d{4}-\d{2}-\d{2}([_T-]\d{2}([:-]\d{2}){1,2}Z?)?', '{DATE}'
  $series = $series -replace 'LCMD_DB_Backup_\d{8}_\d{4}', 'LCMD_DB_Backup_{DATE}'
  $series = $series -replace '\d{8}', '{DATE}'
  $series = $series -replace '\d{10,}', '{TS}'
  return "$Bucket::$series"
}

function Test-IsCriticalRollingBinary([string]$Key) {
  $k = $Key -replace '\\', '/'
  if ($k -match '\.(dump|bak|sql|sql\.gz|sql\.bz2)(\.sha256)?$') { return $true }
  if ($k -match '(?i)LCMD_DB_Backup_') { return $true }
  if ($k -match '(?i)/(nightly|daily|weekly)/') { return $true }
  if ($k -match '(?i)(postgres|mysql|mongo).*\.(dump|bak|sql)') { return $true }
  # Named whole-archive binaries (single file DR packages)
  if ($k -match '(?i)(clawd_backup|hermes_backup|dataautomation_backup|hermes_essential|clawd_websites).*\.(tar\.gz|tgz|zip)$') { return $true }
  if ($k -match '(?i)^[^/]+\.(tar\.gz|tgz)$' -and $k -match '(?i)backup') { return $true }
  return $false
}

function Get-PackageKey {
  param([string]$Bucket, [string]$Key)
  $parts = ($Key -replace '\\', '/').Split('/') | Where-Object { $_ }
  if ($parts.Count -ge 2) {
    return "$Bucket::{0}/{1}" -f $parts[0], $parts[1]
  }
  if ($parts.Count -eq 1) { return "$Bucket::$($parts[0])" }
  return "$Bucket::."
}

function Get-S3AllObjects {
  param([string]$Bucket, [string]$RegionName)
  $all = [System.Collections.Generic.List[object]]::new()
  $token = $null
  do {
    if ($token) {
      $raw = aws s3api list-objects-v2 --bucket $Bucket --region $RegionName --continuation-token $token --output json 2>$null
    } else {
      $raw = aws s3api list-objects-v2 --bucket $Bucket --region $RegionName --output json 2>$null
    }
    if ($LASTEXITCODE -ne 0 -or -not $raw) { break }
    $page = $raw | ConvertFrom-Json
    if ($page.Contents) {
      foreach ($o in @($page.Contents)) { $all.Add($o) | Out-Null }
    }
    if ($page.IsTruncated) { $token = $page.NextContinuationToken } else { $token = $null }
  } while ($token)
  return $all
}

function Format-Bytes([long]$Bytes) {
  if ($Bytes -ge 1GB) { return ('{0:N2} GiB' -f ($Bytes / 1GB)) }
  if ($Bytes -ge 1MB) { return ('{0:N1} MiB' -f ($Bytes / 1MB)) }
  if ($Bytes -ge 1KB) { return ('{0:N0} KiB' -f ($Bytes / 1KB)) }
  return "$Bytes B"
}

function Get-RcloneConfig {
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
  $path = Join-Path $env:TEMP "rclone-binary-pick-$(Get-Date -Format 'HHmmss').conf"
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
  ) -join "`n" | Set-Content $path -Encoding utf8
  return $path
}

# ---- Discover ----
Write-Banner 'Portabase - interactive binary export'
Write-Info 'Policy: most recent backup per series. You visually pick/confirm before upload.'
Write-Info ("PickerMode={0}  (CriticalRolling = dumps/baks only; Packages = folder bundles; AllFiles = every series)" -f $PickerMode)

$accountId = aws sts get-caller-identity --query Account --output text
$scanBuckets = [System.Collections.Generic.List[string]]::new()
$Buckets | ForEach-Object { $scanBuckets.Add($_) }
if ($IncludeAiBackups) { $scanBuckets.Add('dataautomation-ai-backups') }

$rawObjects = [System.Collections.Generic.List[object]]::new()

foreach ($bucket in $scanBuckets) {
  Write-Info "Scanning s3://$bucket (paginated)..."
  $objs = Get-S3AllObjects -Bucket $bucket -RegionName $Region
  Write-Info ("  {0} object(s)" -f $objs.Count)
  foreach ($o in $objs) {
    if (-not $o.Key -or $o.Key.EndsWith('/')) { continue }
    $last = $null
    try { $last = [datetime]$o.LastModified } catch { $last = [datetime]::MinValue }
    $rawObjects.Add([pscustomobject]@{
        Bucket       = $bucket
        Key          = $o.Key
        SizeBytes    = [long]$o.Size
        LastModified = $last
        IsCritical   = (Test-IsCriticalRollingBinary $o.Key)
        Series       = (Get-SeriesKey -Bucket $bucket -Key $o.Key)
        Package      = (Get-PackageKey -Bucket $bucket -Key $o.Key)
      }) | Out-Null
  }
}

$candidates = [System.Collections.Generic.List[object]]::new()

if ($PickerMode -eq 'Packages') {
  # One row per package folder: most recent file date, total size, file count
  $pkgGroups = $rawObjects | Group-Object Package
  foreach ($g in $pkgGroups) {
    $ordered = $g.Group | Sort-Object LastModified -Descending
    $newest = $ordered | Select-Object -First 1
    $sum = ($g.Group | Measure-Object SizeBytes -Sum).Sum
    $candidates.Add([pscustomobject]@{
        Kind             = 'S3-PACKAGE'
        Series           = $g.Name
        Label            = ('{0}  ({1} files, newest {2})' -f $g.Name, $g.Count, $newest.LastModified.ToString('yyyy-MM-dd'))
        Bucket           = $newest.Bucket
        Key              = $newest.Key
        PackagePrefix    = ($newest.Key -replace '\\', '/' -split '/' | Select-Object -First 2) -join '/'
        AmiId            = $null
        SizeBytes        = [long]$sum
        SizeHuman        = (Format-Bytes ([long]$sum))
        LastModified     = $newest.LastModified
        LastModifiedText = $newest.LastModified.ToString('yyyy-MM-dd HH:mm')
        IsMostRecent     = $true
        DefaultSelect    = $true
        Source           = ('s3://{0}/{1}/' -f $newest.Bucket, (($newest.Key -replace '\\', '/' -split '/' | Select-Object -First 2) -join '/'))
        MemberKeys       = @($g.Group | ForEach-Object { $_.Key })
      }) | Out-Null
  }
} else {
  $pool = if ($PickerMode -eq 'CriticalRolling') {
    $rawObjects | Where-Object { $_.IsCritical }
  } else {
    $rawObjects
  }
  foreach ($o in $pool) {
    $candidates.Add([pscustomobject]@{
        Kind             = 'S3'
        Series           = $o.Series
        Label            = ('{0} / {1}' -f $o.Bucket, $o.Key)
        Bucket           = $o.Bucket
        Key              = $o.Key
        PackagePrefix    = $null
        AmiId            = $null
        SizeBytes        = $o.SizeBytes
        SizeHuman        = (Format-Bytes $o.SizeBytes)
        LastModified     = $o.LastModified
        LastModifiedText = $o.LastModified.ToString('yyyy-MM-dd HH:mm')
        IsMostRecent     = $false
        DefaultSelect    = $false
        Source           = ('s3://{0}/{1}' -f $o.Bucket, $o.Key)
        MemberKeys       = @($o.Key)
      }) | Out-Null
  }
  # Mark most recent per series
  $bySeries = $candidates | Group-Object Series
  foreach ($g in $bySeries) {
    $ordered = $g.Group | Sort-Object LastModified -Descending
    $newest = $ordered | Select-Object -First 1
    $newest.IsMostRecent = $true
    $newest.DefaultSelect = $true
  }
}

# AMI offerings (most recent per name prefix)
if ($AlsoAmiImages) {
  Write-Info 'Resolving most-recent AMIs (capece-daily, combo-auto)...'
  $images = (aws ec2 describe-images --owners self --region $Region --output json | ConvertFrom-Json).Images
  foreach ($prefix in @('capece-daily-', 'combo-auto-')) {
    $ami = $images |
      Where-Object { $_.Name -like "$prefix*" -and $_.State -eq 'available' -and $_.RootDeviceType -eq 'ebs' } |
      Sort-Object { [datetime]$_.CreationDate } -Descending |
      Select-Object -First 1
    if (-not $ami) { continue }
    $created = [datetime]$ami.CreationDate
    # Estimate size from root snapshot if available
    $sizeGiB = 0
    $snap = $ami.BlockDeviceMappings | Where-Object { $_.Ebs } | Select-Object -First 1
    if ($snap.Ebs.VolumeSize) { $sizeGiB = [int]$snap.Ebs.VolumeSize }
    $sizeBytes = [long]$sizeGiB * 1GB
    $candidates.Add([pscustomobject]@{
        Kind         = 'AMI'
        Series       = "AMI::$prefix"
        Label        = ('AMI {0} - {1}' -f $ami.ImageId, $ami.Name)
        Bucket       = $ExportBucket
        Key          = ('{0}.bin' -f $ami.ImageId)
        AmiId        = $ami.ImageId
        SizeBytes    = $sizeBytes
        SizeHuman    = if ($sizeGiB) { ('{0} GiB (EBS volume size; .bin may be smaller)' -f $sizeGiB) } else { 'unknown (large)' }
        LastModified = $created
        LastModifiedText = $created.ToString('yyyy-MM-dd HH:mm')
        IsMostRecent = $true
        DefaultSelect = $true
        Source       = "ami:$($ami.ImageId)"
      }) | Out-Null
  }
}

if ($candidates.Count -eq 0) {
  Write-WarnLine 'No binary objects found. Check AWS credentials and bucket names.'
  exit 1
}

# Build picker rows: default only most recent unless IncludeAllInSeries
$pickerRows = if ($IncludeAllInSeries) {
  $candidates | Sort-Object Series, LastModified -Descending
} else {
  $candidates | Where-Object { $_.IsMostRecent } | Sort-Object Series
}

# Enrich display fields
$display = foreach ($r in $pickerRows) {
  [pscustomobject]@{
    SelectHint     = if ($r.DefaultSelect) { 'YES (most recent)' } else { 'no' }
    Kind           = $r.Kind
    Series         = $r.Series
    Label          = $r.Label
    Size           = $r.SizeHuman
    LastModified   = $r.LastModifiedText
    IsMostRecent   = $r.IsMostRecent
    Source         = $r.Source
    PackagePrefix  = $r.PackagePrefix
    # helpers for export (Out-GridView preserves note properties)
    _Bucket        = $r.Bucket
    _Key           = $r.Key
    _AmiId         = $r.AmiId
    _SizeBytes     = $r.SizeBytes
  }
}

if ($ListOnly) {
  Write-Banner 'Default selection (most recent per series) - no upload'
  Write-Host ''
  Write-Host ('  {0,-6} {1,-10} {2,-18} {3}' -f 'KIND', 'SIZE', 'MODIFIED', 'ITEM') -ForegroundColor White
  Write-Host ('  {0}' -f ('-' * 68))
  $totalBytes = 0L
  foreach ($s in ($display | Sort-Object Kind, Label)) {
    Write-Host ('  {0,-6} {1,-10} {2,-18} {3}' -f $s.Kind, $s.Size, $s.LastModified, $s.Label)
    $totalBytes += [long]$s._SizeBytes
  }
  Write-Host ''
  Write-Info ("Series count: {0}   Total size if all accepted: {1}" -f @($display).Count, (Format-Bytes $totalBytes))
  Write-Info 'Run without -ListOnly to open the visual picker and confirm.'
  exit 0
}

Write-Banner 'Visual pick - multi-select the binaries to export'
Write-Info 'A grid will open. Ctrl+click / Shift+click to change the selection.'
Write-Info 'Pre-selected rows are the MOST RECENT in each backup series.'
Write-Info 'Close the grid with OK to continue (Cancel aborts).'
Write-Host ''
$null = Read-Host 'Press Enter to open the picker'

# Pre-highlight most recent rows when the host supports it: user still confirms via PassThru selection.
# Out-GridView does not pre-check rows; we only OFFER most-recent by default (filtered list).
# Tip: with -IncludeAllInSeries, sort by SelectHint and multi-select YES rows.
$selected = $display | Out-GridView -Title 'Portabase binary export - select what to upload (list defaults to most recent only)' -PassThru
if (-not $selected -or @($selected).Count -eq 0) {
  Write-WarnLine 'Nothing selected (or picker cancelled). Aborting.'
  exit 0
}

$selected = @($selected)
$totalBytes = ($selected | Measure-Object -Property _SizeBytes -Sum).Sum

Write-Banner 'CONFIRM export list'
Write-Host ''
Write-Host ('  {0,-6} {1,-10} {2,-18} {3}' -f 'KIND', 'SIZE', 'MODIFIED', 'ITEM') -ForegroundColor White
Write-Host ('  {0}' -f ('-' * 68))
foreach ($s in ($selected | Sort-Object Kind, Label)) {
  Write-Host ('  {0,-6} {1,-10} {2,-18} {3}' -f $s.Kind, $s.Size, $s.LastModified, $s.Label)
}
Write-Host ''
Write-Info ("Count: {0}   Estimated size: {1}" -f $selected.Count, (Format-Bytes ([long]$totalBytes)))
Write-Info "Destination: Dropbox /$DropboxRoot/$accountId/picked/<timestamp>/"
if ($selected | Where-Object { $_.Kind -eq 'AMI' }) {
  Write-WarnLine 'AMI rows export disk images (can be 100+ GiB each and take hours).'
}
Write-Host ''

if ($WhatIf) {
  Write-Ok 'WhatIf: no upload performed.'
  exit 0
}

$answer = Read-Host 'Type YES to export only the items above (anything else cancels)'
if ($answer -ne 'YES') {
  Write-WarnLine 'Cancelled. No files uploaded.'
  exit 0
}

if ($SkipDropbox) {
  Write-Ok 'SkipDropbox set - selection recorded only.'
  exit 0
}

# ---- Export ----
$stamp = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$destRoot = "dropbox:$DropboxRoot/$accountId/picked/$stamp"
$work = Join-Path $env:TEMP "binary-pick-$stamp"
New-Item -ItemType Directory -Force -Path $work | Out-Null
$conf = Get-RcloneConfig
$rclone = @(
  'C:\Users\ryanh\git\portabase.dev\desktop\vendor\rclone.exe',
  'C:\Users\ryanh\git\portabase.dev\release\win-unpacked\resources\tools\rclone.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $rclone) { throw 'rclone.exe not found under desktop/vendor or release tools' }

function Invoke-Rclone { param([Parameter(Mandatory)][string[]]$RcloneArgs)
  Write-Info ("rclone {0}" -f ($RcloneArgs -join ' '))
  & $rclone --config $conf @RcloneArgs
  if ($LASTEXITCODE -ne 0) { throw "rclone failed ($LASTEXITCODE)" }
}

$results = @()
foreach ($s in $selected) {
  try {
    if ($s.Kind -eq 'S3' -or $s.Kind -eq 'S3-PACKAGE') {
      if ($s.Kind -eq 'S3-PACKAGE' -and $s.PackagePrefix) {
        $src = "awss3:$($s._Bucket)/$($s.PackagePrefix)"
        $destDir = "$destRoot/s3/$($s._Bucket)/$($s.PackagePrefix)"
        Invoke-Rclone -RcloneArgs @('copy', $src, $destDir, '--s3-no-check-bucket', '--retries', '10', '--tpslimit', '8', '--progress')
        $results += [pscustomobject]@{ Item = $s.Label; Status = 'OK'; Dest = $destDir }
      } else {
        $src = "awss3:$($s._Bucket)/$($s._Key)"
        $destFile = "$destRoot/s3/$($s._Bucket)/$($s._Key.Replace('\','/'))"
        Invoke-Rclone -RcloneArgs @('copyto', $src, $destFile, '--s3-no-check-bucket', '--retries', '10', '--tpslimit', '8', '--progress')
        $results += [pscustomobject]@{ Item = $s.Label; Status = 'OK'; Dest = $destFile }
      }
      Write-Ok $s.Label
    }
    elseif ($s.Kind -eq 'AMI') {
      Write-Info "Ensuring AMI image is stored in S3 (most recent only): $($s._AmiId)"
      $existing = aws s3api head-object --bucket $ExportBucket --key "$($s._AmiId).bin" --region $Region 2>$null
      if ($LASTEXITCODE -ne 0) {
        Write-Info '  create-store-image-task (may take a long time)...'
        aws ec2 create-store-image-task --region $Region --image-id $s._AmiId --bucket $ExportBucket | Out-Null
        do {
          Start-Sleep -Seconds 30
          $task = (aws ec2 describe-store-image-tasks --region $Region --output json | ConvertFrom-Json).StoreImageTaskResults |
            Where-Object { $_.AmiId -eq $s._AmiId } | Select-Object -First 1
          Write-Info ("  AMI {0}: {1} {2}%" -f $s._AmiId, $task.StoreTaskState, $task.ProgressPercentage)
        } while ($task -and $task.StoreTaskState -in @('InProgress', 'Pending'))
        if (-not $task -or $task.StoreTaskState -ne 'Completed') {
          throw "AMI store failed for $($s._AmiId): $($task.StoreTaskState) $($task.StoreTaskFailureReason)"
        }
      } else {
        Write-Info '  .bin already in export bucket - reusing'
      }
      $destFile = "$destRoot/ami-images/$($s._AmiId).bin"
      Invoke-Rclone -RcloneArgs @('copyto', "awss3:$ExportBucket/$($s._AmiId).bin", $destFile, '--s3-no-check-bucket', '--transfers', '2', '--tpslimit', '4', '--retries', '20', '--progress')
      $results += [pscustomobject]@{ Item = $s.Label; Status = 'OK'; Dest = $destFile }
      Write-Ok $s.Label
    }
  } catch {
    $results += [pscustomobject]@{ Item = $s.Label; Status = "FAIL: $_"; Dest = '' }
    Write-WarnLine "$($s.Label) - $_"
  }
}

$manifest = [ordered]@{
  mode       = 'interactive-pick'
  accountId  = $accountId
  stamp      = $stamp
  dropbox    = "/$DropboxRoot/$accountId/picked/$stamp"
  policy     = 'user-confirmed; default candidates were most-recent-per-series'
  selected   = @($selected | ForEach-Object { $_.Source })
  results    = @($results)
  finishedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$manifestPath = Join-Path $work 'PICKED_EXPORT_MANIFEST.json'
($manifest | ConvertTo-Json -Depth 6) | Set-Content $manifestPath -Encoding utf8
Invoke-Rclone -RcloneArgs @('copy', $manifestPath, "$destRoot/", '--progress')

Write-Banner 'Done'
Write-Info "Dropbox folder: /$DropboxRoot/$accountId/picked/$stamp/"
$results | Format-Table -AutoSize
$fail = @($results | Where-Object { $_.Status -notlike 'OK*' }).Count
if ($fail -gt 0) { exit 2 }
Write-Ok 'All selected binaries exported.'
