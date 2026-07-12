# PortaBase AWS Recovery

This package provisions a recovery vault and restore workspace inside an AWS account owned by the customer. PortaBase does not operate an AWS account, hosted control plane, credential relay, or telemetry service.

## The honest recovery claim

The stack makes the recovery mechanics ready before an incident:

- a retained S3 vault with Versioning and customer KMS encryption;
- optional Governance-mode Object Lock;
- a scheduled ECS Fargate backup task;
- a separate dormant restore task definition;
- source and target secret injection from the customer's Secrets Manager;
- CloudWatch logs and failure/partial-capture alarms;
- direct SNS notification to the customer; and
- an image containing PortaBase, PostgreSQL clients, the pinned Supabase CLI, and AWS CLI v2.

It is a recovery point and restore workspace, not a live replacement Supabase project. A fresh authorized target and explicit cutover are still required.

## Recommended AWS boundary

Use a dedicated recovery account when practical. Enable root MFA, retain customer-controlled break-glass access, and do not share its administrator credentials with PortaBase. The stack roles can access only the named source/target secrets, the generated recovery bucket/prefix, the generated KMS key, ECR image pulls, and logs required by the tasks.

## Build and publish the runner

Create a customer ECR repository, authenticate Docker, build, scan, and push a versioned image. Prefer passing a digest URI to CloudFormation so a later tag change cannot silently alter the recovery runner.

```powershell
aws ecr create-repository --repository-name portabase-recovery --image-scanning-configuration scanOnPush=true --image-tag-mutability IMMUTABLE
$account = aws sts get-caller-identity --query Account --output text
$region = aws configure get region
aws ecr get-login-password --region $region | docker login --username AWS --password-stdin "$account.dkr.ecr.$region.amazonaws.com"
docker build -f aws/Dockerfile -t portabase-recovery:0.2.0 .
docker tag portabase-recovery:0.2.0 "$account.dkr.ecr.$region.amazonaws.com/portabase-recovery:0.2.0"
docker push "$account.dkr.ecr.$region.amazonaws.com/portabase-recovery:0.2.0"
```

The repository does not create or push an image automatically because those are customer-account changes.

## Customer secret schemas

Create the source secret as a JSON object with exactly these keys:

```json
{
  "SUPABASE_DB_URL": "source session-pooler or direct database URL",
  "SUPABASE_URL": "source project URL",
  "SUPABASE_SERVICE_ROLE_KEY": "source service-role or secret key",
  "SUPABASE_ACCESS_TOKEN": "customer Supabase personal access token",
  "PORTABASE_ENCRYPTION_PASSPHRASE": "customer-owned passphrase of at least 16 characters"
}
```

Create a separate target secret with placeholder values at initial provisioning, then replace them only with a newly authorized recovery target during a drill or incident:

```json
{
  "PORTABASE_TARGET_PROJECT_REF": "new target ref",
  "PORTABASE_TARGET_SUPABASE_URL": "new target project URL",
  "PORTABASE_TARGET_SERVICE_ROLE_KEY": "new target service-role or secret key",
  "PORTABASE_TARGET_DB_URL": "new target session-pooler or direct database URL",
  "SUPABASE_ACCESS_TOKEN": "personal access token authorized to deploy to the target"
}
```

Use the AWS console, an approved secrets workflow, or an ignored local file. Do not put secret JSON directly in shell history, CloudFormation parameters, source control, or task environment text.

## Validate and deploy

`deploy.ps1` always validates the template and is a dry run unless `-Execute` is present:

```powershell
.\aws\deploy.ps1 `
  -StackName portabase-recovery `
  -ProjectRef abcdefghijklmnopqrst `
  -ContainerImage 123456789012.dkr.ecr.us-east-1.amazonaws.com/portabase-recovery@sha256:DIGEST `
  -SourceSecretArn arn:aws:secretsmanager:us-east-1:123456789012:secret:portabase-source `
  -TargetSecretArn arn:aws:secretsmanager:us-east-1:123456789012:secret:portabase-target `
  -VpcId vpc-12345678 `
  -SubnetIds 'subnet-11111111,subnet-22222222'
```

After review, add `-Execute`. The subnets need outbound connectivity through NAT/VPC endpoints, or `AssignPublicIp=ENABLED` in appropriate public subnets. The default schedule is every six hours. The bucket and KMS key use `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain` so deleting the stack does not silently delete recovery material.

## Object Lock judgment

The default is disabled. First prove normal backup, retention, deletion, and recovery behavior. Then enable short Governance retention if the customer's threat model requires it. CloudFormation cannot add Object Lock to every existing bucket configuration after creation, so make this decision before the production stack is created.

Do not default customers into Compliance mode. Do not set a retention period longer than their tested operational/legal requirement. A locked ciphertext is useless if the customer loses the separate passphrase or KMS authority.

## First-run acceptance test

Do not wait for the schedule. Run the backup task once manually, then prove all of the following:

1. The ECS task exits with code 0.
2. Logs show `COMPLETE`, not `PARTIAL`.
3. The S3 capsule directory contains `capsule.pbase`, `capsule.json`, `RECOVER.txt`, and `checksums.sha256`.
4. S3 Versioning is enabled and the objects use the generated KMS key.
5. A separate operator can retrieve the capsule and run authenticated decryption.
6. The SNS subscription is confirmed and a test alarm reaches the customer.

The stack's log metric catches thrown failures and partial/failed capsule status. It deliberately treats a missing layer as an alarm condition rather than a successful backup.

## Guarded restore drill

Choose a capsule URI and update the target secret for a disposable fresh Supabase project. Start with a no-write plan by overriding the restore task command:

```json
{
  "containerOverrides": [
    {
      "name": "portabase",
      "command": [
        "restore",
        "--capsule",
        "s3://RECOVERY_BUCKET/capsules/CAPSULE_ID"
      ]
    }
  ]
}
```

Only after reviewing the plan, repeat with `"--execute", "--confirm-target", "NEW_TARGET_REF"`. PortaBase refuses a target equal to the source, refuses a target URL that does not contain the target ref, and refuses a confirmation mismatch.

The restore task rebuilds database roles/schema/data, Storage buckets/objects, and captured Functions. The operator must still reconfigure and verify Auth providers/templates, new API keys, Realtime settings, external secrets, custom domains, DNS, and application behavior before cutover.

## Readiness classification

- Stack created but never run: infrastructure provisioned, not recovery-ready.
- Successful scheduled capsule: backup path verified.
- Capsule downloaded and authenticated-decrypted: independent recovery artifact verified.
- Timed restore into a disposable target plus application tests: disaster recovery proven for that tested scope and point in time.

The last classification is the one a serious business should use when deciding whether its actual recovery time is acceptable.
