#Requires -Version 5.1
<#
.SYNOPSIS
  Super-simple wizard: create the MINIMUM AWS permissions for Portabase export scripts.

.DESCRIPTION
  For people who do not use the AWS console. Run this on a machine that already has
  AWS admin (or IAM full) access configured. The script:

  1. Asks easy yes/no questions in plain English
  2. Writes policy JSON files you can keep
  3. Creates IAM users + attaches only those policies (via AWS CLI — no console clicks)
  4. Saves access keys to a protected folder and tells you exactly who gets which file

  Two roles (least privilege):
    MAP  = list/discover backups and build "most recent" mappings only
    SHIP = also read dump files, stage AMI images, and read secrets-bundle for Dropbox OAuth

.EXAMPLE
  .\scripts\generate-export-iam-grants.ps1
#>
param(
  [string]$Region = 'us-east-1',
  [string]$OutputDir = '',
  [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Write-Title([string]$T) {
  Write-Host ''
  Write-Host '============================================================' -ForegroundColor Cyan
  Write-Host "  $T" -ForegroundColor Cyan
  Write-Host '============================================================' -ForegroundColor Cyan
}
function Write-Say([string]$T) { Write-Host "  $T" -ForegroundColor Gray }
function Write-Ok([string]$T) { Write-Host "  [OK] $T" -ForegroundColor Green }
function Write-Bad([string]$T) { Write-Host "  [!!] $T" -ForegroundColor Yellow }
function Write-Ask([string]$T) { Write-Host "  ? $T" -ForegroundColor White }

function Read-YesNo {
  param([string]$Question, [bool]$DefaultYes = $true)
  $hint = if ($DefaultYes) { 'Y/n' } else { 'y/N' }
  while ($true) {
    Write-Ask "$Question [$hint]"
    $a = (Read-Host '    Your answer').Trim().ToLowerInvariant()
    if ($a -eq '' ) { return $DefaultYes }
    if ($a -in @('y', 'yes')) { return $true }
    if ($a -in @('n', 'no')) { return $false }
    Write-Bad 'Please type yes or no (or press Enter for the default).'
  }
}

function Get-PolicyMapJson {
  @'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "Identity",
      "Effect": "Allow",
      "Action": ["sts:GetCallerIdentity"],
      "Resource": "*"
    },
    {
      "Sid": "ListIamMap",
      "Effect": "Allow",
      "Action": [
        "iam:ListUsers",
        "iam:ListRoles",
        "iam:ListGroups",
        "iam:ListPolicies",
        "iam:ListInstanceProfiles",
        "iam:ListOpenIDConnectProviders",
        "iam:ListSAMLProviders",
        "iam:ListAccountAliases"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DescribeComputeNetwork",
      "Effect": "Allow",
      "Action": [
        "ec2:Describe*",
        "ecs:ListClusters",
        "ecs:ListServices",
        "ecs:DescribeClusters",
        "ecs:DescribeServices",
        "lambda:ListFunctions",
        "elasticloadbalancing:Describe*",
        "autoscaling:Describe*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListBucketsAndObjectsMetadata",
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketTagging",
        "s3:GetBucketVersioning"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DescribeDataServices",
      "Effect": "Allow",
      "Action": [
        "rds:Describe*",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "logs:DescribeLogGroups",
        "sns:ListTopics",
        "sqs:ListQueues",
        "kms:ListKeys",
        "kms:DescribeKey",
        "cloudformation:ListStacks",
        "cloudformation:DescribeStacks",
        "cognito-idp:ListUserPools",
        "dlm:GetLifecyclePolicies",
        "ssm:DescribeParameters",
        "route53:ListHostedZones",
        "cloudfront:ListDistributions",
        "ecr:DescribeRepositories"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ListSecretNamesOnly",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:ListSecrets",
        "secretsmanager:DescribeSecret"
      ],
      "Resource": "*"
    }
  ]
}
'@
}

function Get-PolicyShipJson {
  param([string[]]$BackupBuckets, [string]$ExportBucket, [string]$AccountId, [string]$AwsRegion)
  $bucketResources = [System.Collections.Generic.List[string]]::new()
  foreach ($b in $BackupBuckets) {
    $bucketResources.Add("arn:aws:s3:::$b") | Out-Null
    $bucketResources.Add("arn:aws:s3:::$b/*") | Out-Null
  }
  $exportArn = "arn:aws:s3:::$ExportBucket"
  $exportArnStar = "arn:aws:s3:::$ExportBucket/*"
  $secretArn = "arn:aws:secretsmanager:${AwsRegion}:${AccountId}:secret:secrets-bundle-*"

  $bucketJson = ($bucketResources | ForEach-Object { '        "' + $_ + '"' }) -join ",`n"

  return @"
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSecretsBundleDropboxOauthOnly",
      "Effect": "Allow",
      "Action": ["secretsmanager:GetSecretValue"],
      "Resource": "$secretArn"
    },
    {
      "Sid": "ReadBackupBinaries",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
$bucketJson
      ]
    },
    {
      "Sid": "AmiExportStagingBucket",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket",
        "s3:GetBucketLocation",
        "s3:GetBucketAcl",
        "s3:AbortMultipartUpload",
        "s3:ListBucketMultipartUploads",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": [
        "$exportArn",
        "$exportArnStar"
      ]
    },
    {
      "Sid": "AmiStoreImageTasks",
      "Effect": "Allow",
      "Action": [
        "ec2:CreateStoreImageTask",
        "ec2:DescribeStoreImageTasks",
        "ec2:DescribeImages",
        "ec2:DescribeSnapshots"
      ],
      "Resource": "*"
    }
  ]
}
"@
}

# -------------------- Start --------------------
Clear-Host
Write-Title 'Portabase — easy permission generator'
Write-Say 'This creates the SMALLEST set of AWS permissions for backup export tools.'
Write-Say 'You do not need to click around the AWS website if this machine can already run "aws" commands as an admin.'
Write-Host ''

# Check AWS
try {
  $ident = aws sts get-caller-identity --output json 2>$null | ConvertFrom-Json
} catch {
  $ident = $null
}
if (-not $ident) {
  Write-Bad 'AWS is not logged in on this computer.'
  Write-Say 'Someone with admin access should run this once after:'
  Write-Say '  aws configure'
  Write-Say 'Then re-run this script.'
  exit 1
}

$accountId = $ident.Account
Write-Ok "Found AWS account: $accountId"
Write-Ok "Logged in as: $($ident.Arn)"
Write-Host ''

Write-Title 'Step 1 — What do you need?'
Write-Say 'MAP  = only LIST backups and build lists (who/what/most recent). Cannot download dumps.'
Write-Say 'SHIP = also COPY dump files and disk images, and read Dropbox login from secrets-bundle.'
Write-Host ''

$wantMap = Read-YesNo 'Create the MAP user (list/discover only)?' $true
$wantShip = Read-YesNo 'Create the SHIP user (copy binaries + Dropbox auth)?' $true

if (-not $wantMap -and -not $wantShip) {
  Write-Bad 'Nothing selected. Exiting.'
  exit 0
}

Write-Title 'Step 2 — Which backup folders (S3 buckets) may SHIP read?'
Write-Say 'Press Enter to use the recommended list for this account.'
Write-Say 'Or type bucket names separated by commas.'
$defaultBuckets = @(
  'capece-supabase-backups',
  'dbasebackups',
  'dataautomation-emergency-backups',
  'dataautomation-ai-backups',
  'capece-backup-deploy-899867382621'
)
Write-Ask 'Backup buckets (Enter = recommended)'
$bucketAnswer = (Read-Host '    Buckets').Trim()
if ($bucketAnswer) {
  $backupBuckets = @($bucketAnswer -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
} else {
  $backupBuckets = $defaultBuckets
}

$exportBucket = 'aws-binary-dr-exports-899867382621'
Write-Ask "S3 bucket for AMI image staging (Enter = $exportBucket)"
$eb = (Read-Host '    Export bucket').Trim()
if ($eb) { $exportBucket = $eb }

if (-not $OutputDir) {
  $OutputDir = Join-Path $env:USERPROFILE "Desktop\Portabase-export-grants-$(Get-Date -Format 'yyyyMMdd-HHmm')"
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$keysDir = Join-Path $OutputDir 'ACCESS-KEYS-KEEP-PRIVATE'
New-Item -ItemType Directory -Force -Path $keysDir | Out-Null

# Write policy files
$mapPath = Join-Path $OutputDir 'policy-map-only.json'
$shipPath = Join-Path $OutputDir 'policy-ship-binaries.json'
Get-PolicyMapJson | Set-Content $mapPath -Encoding utf8
if ($wantShip) {
  Get-PolicyShipJson -BackupBuckets $backupBuckets -ExportBucket $exportBucket -AccountId $accountId -AwsRegion $Region |
    Set-Content $shipPath -Encoding utf8
}

Write-Ok "Saved policy files in: $OutputDir"

# Human README
$readme = @"
Portabase export permissions (generated)
========================================

AWS account: $accountId
Created:     $((Get-Date).ToString('u'))
Region:      $Region

WHAT WAS CREATED
----------------
$(if ($wantMap) { '- MAP user:  portabase-export-map   (list backups / build mappings only)' } else { '' })
$(if ($wantShip) { '- SHIP user: portabase-export-ship  (copy binaries + Dropbox secret read)' } else { '' })

WHO SHOULD USE WHICH
--------------------
- Person who only browses "what would we export?":
    Use MAP keys only.
- Person who uploads dumps/images to Dropbox after saying YES:
    Use SHIP keys (or MAP+SHIP if they also list).

NEVER give SHIP keys to someone who should not read backups or secrets-bundle.

FILES IN THIS FOLDER
--------------------
- policy-map-only.json
$(if ($wantShip) { '- policy-ship-binaries.json' } else { '' })
- ACCESS-KEYS-KEEP-PRIVATE\   <--- treat like passwords
- apply-log.txt

HOW TO USE THE KEYS (on the export PC)
--------------------------------------
1. Install AWS CLI if needed.
2. Run:  aws configure
3. Paste Access Key ID and Secret Access Key from the matching .txt file.
4. Region: $Region
5. Then run the export scripts from the Portabase repo.

CONSOLE FALLBACK (only if automatic create failed)
--------------------------------------------------
1. Sign in to https://console.aws.amazon.com/iam/
2. Users -> Create user -> name as above -> Attach policies by uploading the JSON files
   (or create policy from JSON, then attach).
3. Security credentials -> Create access key -> Command Line Interface.
4. Save the key into ACCESS-KEYS-KEEP-PRIVATE yourself.

SECURITY
--------
- These users cannot create new admin users or read all secrets (SHIP only reads secrets-bundle).
- MAP cannot download S3 dump objects.
- Delete keys and users when no longer needed.
"@
Set-Content (Join-Path $OutputDir 'README-START-HERE.txt') $readme -Encoding utf8

if ($WhatIf) {
  Write-Title 'WhatIf — policies written only; no IAM users created'
  Write-Ok $OutputDir
  exit 0
}

Write-Title 'Step 3 — Create users in AWS automatically?'
Write-Say 'If you say YES, this script will create the users and policies for you (no console).'
$doCreate = Read-YesNo 'Create IAM users and attach policies now?' $true

$log = [System.Collections.Generic.List[string]]::new()
function Log([string]$M) { $log.Add("$(Get-Date -Format o)  $M") | Out-Null; Write-Say $M }

if (-not $doCreate) {
  Write-Bad 'Skipped automatic create. Policy JSON + README are ready in the folder.'
  Write-Ok $OutputDir
  Write-Say 'Open README-START-HERE.txt for console steps if someone else must click.'
  $log | Set-Content (Join-Path $OutputDir 'apply-log.txt')
  exit 0
}

function Ensure-IamPolicy {
  param([string]$PolicyName, [string]$PolicyFile)
  $arn = "arn:aws:iam::${accountId}:policy/$PolicyName"
  $exists = aws iam get-policy --policy-arn $arn 2>$null
  if ($LASTEXITCODE -eq 0) {
    Log "Policy exists, creating new version: $PolicyName"
    # Set as default: create version and set default
    aws iam create-policy-version --policy-arn $arn --policy-document "file://$PolicyFile" --set-as-default 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
      # maybe quota on versions — delete oldest non-default
      Log "Retry policy version for $PolicyName after cleanup..."
      $vers = aws iam list-policy-versions --policy-arn $arn --output json | ConvertFrom-Json
      $old = $vers.Versions | Where-Object { -not $_.IsDefaultVersion } | Sort-Object CreateDate | Select-Object -First 1
      if ($old) {
        aws iam delete-policy-version --policy-arn $arn --version-id $old.VersionId 2>&1 | Out-Null
        aws iam create-policy-version --policy-arn $arn --policy-document "file://$PolicyFile" --set-as-default 2>&1 | Out-Null
      }
    }
  } else {
    Log "Creating policy: $PolicyName"
    aws iam create-policy --policy-name $PolicyName --policy-document "file://$PolicyFile" --description "Portabase export least privilege ($PolicyName)" 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create policy $PolicyName" }
  }
  return $arn
}

function Ensure-IamUserWithKey {
  param([string]$UserName, [string]$PolicyArn, [string]$KeyOutFile)
  $u = aws iam get-user --user-name $UserName 2>$null
  if ($LASTEXITCODE -ne 0) {
    Log "Creating user: $UserName"
    aws iam create-user --user-name $UserName --tags Key=Purpose,Value=PortabaseExport Key=ManagedBy,Value=generate-export-iam-grants 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to create user $UserName (need iam:CreateUser)" }
  } else {
    Log "User already exists: $UserName"
  }
  aws iam attach-user-policy --user-name $UserName --policy-arn $PolicyArn 2>&1 | Out-Null
  Log "Attached $PolicyArn to $UserName"

  # Create access key (user may already have 2 — delete oldest inactive if needed)
  Log "Creating access key for $UserName ..."
  $keyJson = aws iam create-access-key --user-name $UserName --output json 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log "Could not create access key (limit 2?). Listing existing keys — delete one in console or: aws iam delete-access-key"
    $keyJson | Out-String | ForEach-Object { Log $_ }
    @"
User: $UserName
Policy: $PolicyArn
Access key: NOT CREATED — user already has 2 keys or permission denied.
Run: aws iam list-access-keys --user-name $UserName
Then delete one and re-run this script, or create a key in the console.
"@ | Set-Content $KeyOutFile -Encoding utf8
    return
  }
  $key = ($keyJson | ConvertFrom-Json).AccessKey
  @"
============================================================
PORTABASE EXPORT CREDENTIALS — KEEP PRIVATE
============================================================
User name:       $UserName
AWS account:     $accountId
Access Key ID:   $($key.AccessKeyId)
Secret Access Key: $($key.SecretAccessKey)
Region:          $Region

Setup on the export computer:
  1. aws configure
  2. Paste Access Key ID
  3. Paste Secret Access Key
  4. Default region: $Region
  5. Output format: json

Then run the Portabase export scripts.

DELETE this file from shared drives / chat after saving to a password manager.
============================================================
"@ | Set-Content $KeyOutFile -Encoding utf8
  try {
    icacls $KeyOutFile /inheritance:r /grant:r "${env:USERNAME}:(R)" 2>$null | Out-Null
  } catch { }
  Log "Wrote key file: $KeyOutFile"
}

try {
  if ($wantMap) {
    $mapArn = Ensure-IamPolicy -PolicyName 'PortabaseExportMapOnly' -PolicyFile $mapPath
    Ensure-IamUserWithKey -UserName 'portabase-export-map' -PolicyArn $mapArn -KeyOutFile (Join-Path $keysDir 'MAP-user-portabase-export-map.txt')
  }
  if ($wantShip) {
    # Ship gets MAP abilities too for convenience when one person does both
    $shipArn = Ensure-IamPolicy -PolicyName 'PortabaseExportShipBinaries' -PolicyFile $shipPath
    # Combine: attach both policies to ship user if map exists
    Ensure-IamUserWithKey -UserName 'portabase-export-ship' -PolicyArn $shipArn -KeyOutFile (Join-Path $keysDir 'SHIP-user-portabase-export-ship.txt')
    if ($wantMap) {
      $mapArn2 = "arn:aws:iam::${accountId}:policy/PortabaseExportMapOnly"
      aws iam attach-user-policy --user-name 'portabase-export-ship' --policy-arn $mapArn2 2>&1 | Out-Null
      Log 'Also attached MAP policy to SHIP user (one person can list + copy).'
    }
  }
  Write-Title 'Success'
  Write-Ok "Everything is in: $OutputDir"
  Write-Say 'Open README-START-HERE.txt'
  Write-Say 'Open ACCESS-KEYS-KEEP-PRIVATE only on a private screen.'
  Write-Host ''
  Write-Say 'Quick test as MAP user (after aws configure with MAP keys):'
  Write-Say '  aws sts get-caller-identity'
  Write-Say '  aws s3 ls'
  Write-Say 'Quick test as SHIP user:'
  Write-Say '  aws secretsmanager get-secret-value --secret-id secrets-bundle --query Name'
} catch {
  Write-Bad "Automatic create failed: $_"
  Write-Say 'Policy JSON files are still saved. Use README-START-HERE.txt console fallback,'
  Write-Say 'or re-run this script while logged in as an IAM admin.'
  Log "ERROR: $_"
  exit 1
} finally {
  $log | Set-Content (Join-Path $OutputDir 'apply-log.txt') -Encoding utf8
}

Write-Host ''
Write-Ok 'Done. Minimum grants generated and (if possible) applied.'
