param(
  [Parameter(Mandatory = $true)][string]$StackName,
  [Parameter(Mandatory = $true)][string]$ProjectRef,
  [Parameter(Mandatory = $true)][string]$ContainerImage,
  [Parameter(Mandatory = $true)][string]$SourceSecretArn,
  [Parameter(Mandatory = $true)][string]$TargetSecretArn,
  [Parameter(Mandatory = $true)][string]$VpcId,
  [Parameter(Mandatory = $true)][string]$SubnetIds,
  [string]$ScheduleExpression = 'rate(6 hours)',
  [ValidateSet('Disabled', 'Governance')][string]$ObjectLockMode = 'Disabled',
  [string]$AlertEmail = '',
  [switch]$Execute
)

$ErrorActionPreference = 'Stop'
$template = Join-Path $PSScriptRoot 'cloudformation\portabase-recovery.yaml'

aws cloudformation validate-template --template-body "file://$($template.Replace('\', '/'))" | Out-Null

$parameters = @(
  "ProjectRef=$ProjectRef",
  "ContainerImage=$ContainerImage",
  "SourceSecretArn=$SourceSecretArn",
  "TargetSecretArn=$TargetSecretArn",
  "VpcId=$VpcId",
  "SubnetIds=$SubnetIds",
  "ScheduleExpression=$ScheduleExpression",
  "ObjectLockMode=$ObjectLockMode"
)
if ($AlertEmail) { $parameters += "AlertEmail=$AlertEmail" }

Write-Host "Validated Portabase recovery stack: $StackName"
Write-Host "Project ref: $ProjectRef"
Write-Host "Object Lock: $ObjectLockMode"
Write-Host "Schedule: $ScheduleExpression"

if (-not $Execute) {
  Write-Host 'DRY RUN ONLY. Re-run with -Execute to create or update the customer-owned stack.'
  exit 0
}

aws cloudformation deploy `
  --stack-name $StackName `
  --template-file $template `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides $parameters `
  --no-fail-on-empty-changeset

aws cloudformation describe-stacks --stack-name $StackName --query 'Stacks[0].Outputs' --output table
