#Requires -Version 5.1
<#
.SYNOPSIS
  Resolve the most recent completed EBS snapshot (or AMI) for Portabase restores/launches.

.DESCRIPTION
  Policy: with EBS volume images, ALWAYS take the most recent completed backup.
  Never use a hand-picked older snapshot unless -SnapshotId override is passed.

.EXAMPLE
  .\scripts\aws-latest-ebs-snapshot.ps1
  .\scripts\aws-latest-ebs-snapshot.ps1 -VolumeId vol-abc123
  .\scripts\aws-latest-ebs-snapshot.ps1 -AsAmi
  .\scripts\aws-latest-ebs-snapshot.ps1 -SnapshotId snap-old -ForceOverride
#>
param(
  [string]$Region = "us-east-1",
  [string]$VolumeId = "",
  [string]$TagKey = "PortabaseBackup",
  [string]$TagValue = "true",
  [string]$AmiNamePrefix = "portabase-",
  [switch]$AsAmi,
  [string]$SnapshotId = "",
  [switch]$ForceOverride,
  [switch]$Json
)

$ErrorActionPreference = "Stop"

if ($SnapshotId -and -not $ForceOverride) {
  Write-Error "Refusing pinned snapshot $SnapshotId without -ForceOverride. Policy: always use most recent backup."
}

if ($SnapshotId -and $ForceOverride) {
  $snap = aws ec2 describe-snapshots --region $Region --snapshot-ids $SnapshotId --query "Snapshots[0]" --output json | ConvertFrom-Json
  if (-not $snap) { Write-Error "Snapshot not found: $SnapshotId" }
  $result = [ordered]@{
    policy     = "override"
    snapshotId = $snap.SnapshotId
    startTime  = $snap.StartTime
    volumeId   = $snap.VolumeId
    state      = $snap.State
    warning    = "FORCED_OVERRIDE_not_most_recent"
  }
  if ($Json) { $result | ConvertTo-Json -Compress; exit 0 }
  $result.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }
  exit 0
}

if ($AsAmi) {
  $filters = @(
    "Name=name,Values=${AmiNamePrefix}*"
    "Name=state,Values=available"
    "Name=root-device-type,Values=ebs"
    "Name=is-public,Values=false"
  )
  if ($TagKey) { $filters += "Name=tag:${TagKey},Values=$TagValue" }

  $amis = aws ec2 describe-images --region $Region --owners self --filters $filters --query "Images" --output json | ConvertFrom-Json
  if (-not $amis -or $amis.Count -eq 0) { Write-Error "No matching EBS AMIs found." }

  $latest = $amis | Sort-Object { [datetime]$_.CreationDate } -Descending | Select-Object -First 1
  $result = [ordered]@{
    policy       = "most_recent"
    amiId        = $latest.ImageId
    name         = $latest.Name
    creationDate = $latest.CreationDate
    rootDevice   = $latest.RootDeviceType
  }
  if ($Json) { $result | ConvertTo-Json -Compress; exit 0 }
  $result.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }
  exit 0
}

$filterArgs = @(
  "Name=status,Values=completed"
  "Name=owner-id,Values=self"
)
if ($TagKey) { $filterArgs += "Name=tag:${TagKey},Values=$TagValue" }
if ($VolumeId) { $filterArgs += "Name=volume-id,Values=$VolumeId" }

# AWS CLI: owners self via owner-ids; filter completed only
$query = "Snapshots | sort_by(@, &StartTime) | [-1]"
$snapJson = aws ec2 describe-snapshots --region $Region --owner-ids self --filters $filterArgs --query $query --output json
$snap = $snapJson | ConvertFrom-Json
if (-not $snap -or -not $snap.SnapshotId) {
  Write-Error "No completed EBS snapshots matched filters (tag $TagKey=$TagValue$(if ($VolumeId) { ", volume $VolumeId" }))."
}

$result = [ordered]@{
  policy     = "most_recent"
  snapshotId = $snap.SnapshotId
  startTime  = $snap.StartTime
  volumeId   = $snap.VolumeId
  volumeSize = $snap.VolumeSize
  state      = $snap.State
  description = $snap.Description
}

if ($Json) { $result | ConvertTo-Json -Compress; exit 0 }
$result.GetEnumerator() | ForEach-Object { "{0}={1}" -f $_.Key, $_.Value }
