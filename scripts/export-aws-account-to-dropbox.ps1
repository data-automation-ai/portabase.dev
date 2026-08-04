#Requires -Version 5.1
<#
.SYNOPSIS
  Export an AWS account inventory/config snapshot to Dropbox (via rclone + secrets-bundle Dropbox OAuth).

.DESCRIPTION
  Collects resource inventory and configuration metadata — not live secret VALUES.
  Secret names/ARNs are listed; secret strings are not exported.
  Uploads a dated zip/folder to Dropbox under /AWS-Account-Exports/<accountId>/<timestamp>/
#>
param(
  [string]$Region = "us-east-1",
  [string[]]$Regions = @("us-east-1", "us-east-2", "us-west-2"),
  [string]$DropboxPath = "AWS-Account-Exports",
  [string]$WorkRoot = "",
  [switch]$SkipUpload
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$stamp = Get-Date -Format "yyyy-MM-dd_HHmmss"
$account = (aws sts get-caller-identity --output json | ConvertFrom-Json)
$accountId = $account.Account
if (-not $WorkRoot) {
  $WorkRoot = Join-Path $env:TEMP "aws-export-$accountId-$stamp"
}
$exportDir = Join-Path $WorkRoot "export"
New-Item -ItemType Directory -Force -Path $exportDir | Out-Null

function Save-Json($Path, $Object) {
  $dir = Split-Path -Parent $Path
  if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  ($Object | ConvertTo-Json -Depth 30) | Set-Content -Path $Path -Encoding utf8
}

function Invoke-AwsJson([string[]]$AwsArgs) {
  try {
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $raw = & aws @AwsArgs --output json 2>&1
    $ErrorActionPreference = $prev
    if ($LASTEXITCODE -ne 0) { return $null }
    $text = ($raw | Where-Object { $_ -is [string] -or $_.GetType().Name -eq 'String' }) -join "`n"
    if (-not $text) {
      # Some ErrorRecord streams still carry stdout
      $text = ($raw | ForEach-Object { "$_" }) -join "`n"
    }
    if (-not $text -or $text -notmatch '^\s*[\[{]') { return $null }
    return ($text | ConvertFrom-Json)
  } catch {
    return $null
  }
}

Write-Host "Exporting AWS account $accountId → $exportDir"

# ---- Global / account ----
Save-Json (Join-Path $exportDir "account.json") @{
  exportedAt = (Get-Date).ToUniversalTime().ToString("o")
  identity   = $account
  aliases    = Invoke-AwsJson @("iam", "list-account-aliases")
  summary    = "Inventory export only. Secret values, private keys, and DB passwords are NOT included."
}

# IAM (metadata)
Save-Json (Join-Path $exportDir "iam\users.json") (Invoke-AwsJson @("iam", "list-users"))
Save-Json (Join-Path $exportDir "iam\roles.json") (Invoke-AwsJson @("iam", "list-roles"))
Save-Json (Join-Path $exportDir "iam\policies.json") (Invoke-AwsJson @("iam", "list-policies", "--scope", "Local"))
Save-Json (Join-Path $exportDir "iam\groups.json") (Invoke-AwsJson @("iam", "list-groups"))
Save-Json (Join-Path $exportDir "iam\instance-profiles.json") (Invoke-AwsJson @("iam", "list-instance-profiles"))
Save-Json (Join-Path $exportDir "iam\openid-providers.json") (Invoke-AwsJson @("iam", "list-open-id-connect-providers"))
Save-Json (Join-Path $exportDir "iam\saml-providers.json") (Invoke-AwsJson @("iam", "list-saml-providers"))

# Global-ish services (default region)
Save-Json (Join-Path $exportDir "s3\buckets.json") (Invoke-AwsJson @("s3api", "list-buckets"))
Save-Json (Join-Path $exportDir "route53\hosted-zones.json") (Invoke-AwsJson @("route53", "list-hosted-zones"))
Save-Json (Join-Path $exportDir "cloudfront\distributions.json") (Invoke-AwsJson @("cloudfront", "list-distributions"))
Save-Json (Join-Path $exportDir "organizations\describe.json") (Invoke-AwsJson @("organizations", "describe-organization"))

# Secrets Manager — names only
$secrets = Invoke-AwsJson @("secretsmanager", "list-secrets", "--region", $Region)
if ($secrets -and $secrets.SecretList) {
  $safe = $secrets.SecretList | ForEach-Object {
    [ordered]@{
      Name         = $_.Name
      ARN          = $_.ARN
      Description  = $_.Description
      LastChanged  = $_.LastChangedDate
      Tags         = $_.Tags
    }
  }
  Save-Json (Join-Path $exportDir "secretsmanager\secret-names-only.json") $safe
}

# Per-region inventory
foreach ($r in $Regions) {
  Write-Host "  region $r ..."
  $rd = Join-Path $exportDir "regions\$r"
  Save-Json (Join-Path $rd "ec2-instances.json") (Invoke-AwsJson @("ec2", "describe-instances", "--region", $r))
  Save-Json (Join-Path $rd "ec2-volumes.json") (Invoke-AwsJson @("ec2", "describe-volumes", "--region", $r))
  Save-Json (Join-Path $rd "ec2-snapshots-self.json") (Invoke-AwsJson @("ec2", "describe-snapshots", "--owner-ids", "self", "--region", $r))
  Save-Json (Join-Path $rd "ec2-amis-self.json") (Invoke-AwsJson @("ec2", "describe-images", "--owners", "self", "--region", $r))
  Save-Json (Join-Path $rd "ec2-security-groups.json") (Invoke-AwsJson @("ec2", "describe-security-groups", "--region", $r))
  Save-Json (Join-Path $rd "ec2-vpcs.json") (Invoke-AwsJson @("ec2", "describe-vpcs", "--region", $r))
  Save-Json (Join-Path $rd "ec2-subnets.json") (Invoke-AwsJson @("ec2", "describe-subnets", "--region", $r))
  Save-Json (Join-Path $rd "ec2-eips.json") (Invoke-AwsJson @("ec2", "describe-addresses", "--region", $r))
  Save-Json (Join-Path $rd "ecs-clusters.json") (Invoke-AwsJson @("ecs", "list-clusters", "--region", $r))
  Save-Json (Join-Path $rd "ecs-services-portabase.json") (Invoke-AwsJson @("ecs", "list-services", "--cluster", "portabase-cloud-prod-runners", "--region", $r))
  Save-Json (Join-Path $rd "lambda-functions.json") (Invoke-AwsJson @("lambda", "list-functions", "--region", $r))
  Save-Json (Join-Path $rd "rds-instances.json") (Invoke-AwsJson @("rds", "describe-db-instances", "--region", $r))
  Save-Json (Join-Path $rd "rds-clusters.json") (Invoke-AwsJson @("rds", "describe-db-clusters", "--region", $r))
  Save-Json (Join-Path $rd "dynamodb-tables.json") (Invoke-AwsJson @("dynamodb", "list-tables", "--region", $r))
  Save-Json (Join-Path $rd "logs-groups.json") (Invoke-AwsJson @("logs", "describe-log-groups", "--region", $r))
  Save-Json (Join-Path $rd "sns-topics.json") (Invoke-AwsJson @("sns", "list-topics", "--region", $r))
  Save-Json (Join-Path $rd "sqs-queues.json") (Invoke-AwsJson @("sqs", "list-queues", "--region", $r))
  Save-Json (Join-Path $rd "apigatewayv2-apis.json") (Invoke-AwsJson @("apigatewayv2", "get-apis", "--region", $r))
  Save-Json (Join-Path $rd "cognito-user-pools.json") (Invoke-AwsJson @("cognito-idp", "list-user-pools", "--max-results", "60", "--region", $r))
  Save-Json (Join-Path $rd "kms-keys.json") (Invoke-AwsJson @("kms", "list-keys", "--region", $r))
  Save-Json (Join-Path $rd "ecr-repositories.json") (Invoke-AwsJson @("ecr", "describe-repositories", "--region", $r))
  Save-Json (Join-Path $rd "cloudformation-stacks.json") (Invoke-AwsJson @("cloudformation", "list-stacks", "--region", $r, "--stack-status-filter", "CREATE_COMPLETE", "UPDATE_COMPLETE", "UPDATE_ROLLBACK_COMPLETE", "IMPORT_COMPLETE"))
  Save-Json (Join-Path $rd "elbv2-load-balancers.json") (Invoke-AwsJson @("elbv2", "describe-load-balancers", "--region", $r))
  Save-Json (Join-Path $rd "autoscaling-groups.json") (Invoke-AwsJson @("autoscaling", "describe-auto-scaling-groups", "--region", $r))
  Save-Json (Join-Path $rd "dlm-policies.json") (Invoke-AwsJson @("dlm", "get-lifecycle-policies", "--region", $r))
  Save-Json (Join-Path $rd "ssm-parameters-names.json") (Invoke-AwsJson @("ssm", "describe-parameters", "--region", $r, "--max-results", "50"))
}

# Portabase Cloud terraform (state may contain sensitive attrs — keep inside private Dropbox path)
$tfDir = "C:\Users\ryanh\git\portabase.dev\aws\cloud\terraform"
if (Test-Path (Join-Path $tfDir "terraform.tfstate")) {
  $tfOut = Join-Path $exportDir "portabase-cloud-terraform"
  New-Item -ItemType Directory -Force -Path $tfOut | Out-Null
  Copy-Item (Join-Path $tfDir "terraform.tfstate") $tfOut -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $tfDir "terraform.tfvars") $tfOut -ErrorAction SilentlyContinue
  Copy-Item (Join-Path $tfDir "outputs.json") $tfOut -ErrorAction SilentlyContinue
  if (Test-Path (Join-Path $tfDir "tfplan")) { Copy-Item (Join-Path $tfDir "tfplan") $tfOut -ErrorAction SilentlyContinue }
  @(
    'Portabase Cloud Terraform snapshot included.'
    'Treat as confidential: state may embed ARNs, IDs, and non-secret config.'
    'Secret VALUES were not re-exported from Secrets Manager.'
  ) -join "`n" | Set-Content (Join-Path $tfOut 'README.txt') -Encoding utf8
}

# Manifest
$files = Get-ChildItem -Path $exportDir -Recurse -File
$manifest = @{
  accountId   = $accountId
  exportedAt  = (Get-Date).ToUniversalTime().ToString("o")
  regions     = $Regions
  fileCount   = $files.Count
  totalBytes  = ($files | Measure-Object -Property Length -Sum).Sum
  policy      = "No secret string values. IAM access keys not exported. Dropbox upload uses OAuth refresh from secrets-bundle."
}
Save-Json (Join-Path $exportDir "MANIFEST.json") $manifest

$readme = @(
  '# AWS account export'
  ''
  "- Account: $accountId"
  "- Exported (UTC): $($manifest.exportedAt)"
  "- Regions: $($Regions -join ', ')"
  "- Files: $($manifest.fileCount)"
  ''
  '## What this is'
  'A configuration/inventory snapshot of AWS resources (JSON describes).'
  ''
  '## What this is NOT'
  '- Not a full disaster-recovery image of all data in S3/RDS'
  '- Not a dump of secret values, private keys, or DB passwords'
  '- Not a substitute for Portabase capsules or EBS snapshots of workload disks'
  ''
  '## Restore guidance'
  'Use files under regions/ and iam/ to rebuild understanding of the account.'
  'Re-apply Terraform from portabase-cloud-terraform/ where present.'
) -join "`n"
Set-Content -Path (Join-Path $exportDir "README.md") -Value $readme -Encoding utf8

# Zip
$zipPath = Join-Path $WorkRoot ("aws-account-{0}-{1}.zip" -f $accountId, $stamp)
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path (Join-Path $exportDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
$zipMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host ("Zip: {0} ({1} MB)" -f $zipPath, $zipMb)

if ($SkipUpload) {
  Write-Host ("SkipUpload set - local only: {0}" -f $exportDir)
  return @{ localPath = $exportDir; zipPath = $zipPath; dropbox = $null }
}

# Dropbox via secrets-bundle + rclone
$bundle = aws secretsmanager get-secret-value --secret-id secrets-bundle --query SecretString --output text | ConvertFrom-Json
$clientId = $bundle.'dropbox-app-key'
$clientSecret = $bundle.'dropbox-app-secret'
$refresh = $bundle.'dropbox-refresh-token'
$tokenResp = Invoke-RestMethod -Method Post -Uri 'https://api.dropboxapi.com/oauth2/token' -Body @{
  grant_type    = 'refresh_token'
  refresh_token = $refresh
  client_id     = $clientId
  client_secret = $clientSecret
} -ContentType 'application/x-www-form-urlencoded'

$confDir = Join-Path $WorkRoot 'rclone'
New-Item -ItemType Directory -Force -Path $confDir | Out-Null
$expiry = (Get-Date).ToUniversalTime().AddSeconds([int]$tokenResp.expires_in).ToString('o')
$tokenJson = (@{
  access_token  = $tokenResp.access_token
  token_type    = 'bearer'
  refresh_token = $refresh
  expiry        = $expiry
} | ConvertTo-Json -Compress)
$rcloneConf = @(
  '[dropbox]'
  'type = dropbox'
  "client_id = $clientId"
  "client_secret = $clientSecret"
  "token = $tokenJson"
) -join "`n"
Set-Content -Path (Join-Path $confDir 'rclone.conf') -Value $rcloneConf -Encoding utf8

$rclone = @(
  'C:\Users\ryanh\git\portabase.dev\desktop\vendor\rclone.exe',
  'C:\Users\ryanh\git\portabase.dev\release\win-unpacked\resources\tools\rclone.exe'
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $rclone) { throw 'rclone.exe not found' }

$dest = "dropbox:$DropboxPath/$accountId/$stamp"
Write-Host ("Uploading to {0} ..." -f $dest)
& $rclone --config (Join-Path $confDir 'rclone.conf') copy $exportDir $dest --create-empty-src-dirs -P
& $rclone --config (Join-Path $confDir 'rclone.conf') copy $zipPath ("dropbox:{0}/{1}/" -f $DropboxPath, $accountId) -P
& $rclone --config (Join-Path $confDir 'rclone.conf') lsf $dest --max-depth 2 | Select-Object -First 40

Write-Host ("Done. Dropbox folder: /{0}/{1}/{2}/" -f $DropboxPath, $accountId, $stamp)
Write-Host ("Done. Dropbox zip: /{0}/{1}/aws-account-{1}-{2}.zip" -f $DropboxPath, $accountId, $stamp)

[pscustomobject]@{
  accountId  = $accountId
  localPath  = $exportDir
  zipPath    = $zipPath
  dropboxDir = "/$DropboxPath/$accountId/$stamp"
  dropboxZip = "/$DropboxPath/$accountId/aws-account-$accountId-$stamp.zip"
}
