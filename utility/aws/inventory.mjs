/**
 * Build a normalized AWS inventory from a fixture or read-only collector client.
 * Does not call live AWS. Does not create snapshots.
 */

import { createFixtureClient } from './interfaces.mjs';
import { namesOnlyMap, redactTxtRdata } from './redaction.mjs';
import { RESOURCE_CLASS } from './binary-decision.mjs';
import {
  collectS3ObjectsFromFixture,
  latestForVolume,
  resolveAccountLatestBackups,
} from './latest-backup.mjs';
import { AWS_INVENTORY_SCHEMA_VERSION } from './versions.mjs';

const GIB = 1024 ** 3;

export function bytesToGiB(bytes) {
  return Math.round(((Number(bytes) || 0) / GIB) * 1000) / 1000;
}

/**
 * Normalize a fixture document (or collector-backed fixture) into inventory resources.
 * @param {object} fixture
 * @returns {{ schemaVersion: string, account: object, regions: string[], resources: object[], edges: object[] }}
 */
export function buildInventory(fixture) {
  if (!fixture || typeof fixture !== 'object') {
    throw new Error('buildInventory requires a fixture or collected document.');
  }
  const client = createFixtureClient(fixture);
  const accountId = fixture.accountId || fixture.account?.accountId;
  if (!accountId) throw new Error('fixture.accountId is required');
  const regions = fixture.regions?.length ? fixture.regions : ['us-east-1'];
  const region = regions[0];
  const resources = [];

  resources.push({
    resourceClass: RESOURCE_CLASS.ACCOUNT,
    id: accountId,
    region: null,
    aliases: fixture.aliases || [],
    sizeGiB: 0,
  });

  for (const user of fixture.iam?.users || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.IAM_USER,
      id: user.UserName,
      arn: user.Arn,
      region: null,
      accessKeyIds: (user.AccessKeyIds || []).filter(Boolean),
      attachedPolicies: user.AttachedPolicies || [],
      sizeGiB: 0,
      scriptedPayload: {
        UserName: user.UserName,
        UserId: user.UserId,
        Arn: user.Arn,
        Path: user.Path || '/',
        AttachedPolicies: user.AttachedPolicies || [],
        AccessKeyIds: user.AccessKeyIds || [],
      },
    });
  }
  for (const policy of fixture.iam?.policies || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.IAM_POLICY,
      id: policy.PolicyName || policy.Arn,
      arn: policy.Arn,
      region: null,
      sizeGiB: 0,
      scriptedPayload: {
        PolicyName: policy.PolicyName,
        Arn: policy.Arn,
        PolicyDocument: policy.PolicyDocument || null,
      },
    });
  }
  for (const profile of fixture.iam?.instanceProfiles || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.IAM_INSTANCE_PROFILE,
      id: profile.InstanceProfileName,
      arn: profile.Arn,
      region: null,
      sizeGiB: 0,
      scriptedPayload: {
        InstanceProfileName: profile.InstanceProfileName,
        Arn: profile.Arn,
        Roles: profile.Roles || [],
      },
    });
  }
  for (const role of fixture.iam?.roles || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.IAM_ROLE,
      id: role.RoleName,
      arn: role.Arn,
      region: null,
      sizeGiB: 0,
      scriptedPayload: {
        RoleName: role.RoleName,
        Arn: role.Arn,
        AssumeRolePolicyDocument: role.AssumeRolePolicyDocument || null,
        AttachedPolicies: role.AttachedPolicies || [],
      },
    });
  }

  for (const vpc of fixture.vpc?.vpcs || fixture.ec2?.vpcs || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.VPC,
      id: vpc.VpcId,
      region,
      cidr: vpc.CidrBlock,
      sizeGiB: 0,
      scriptedPayload: vpc,
    });
  }
  for (const subnet of fixture.vpc?.subnets || fixture.ec2?.subnets || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SUBNET,
      id: subnet.SubnetId,
      region,
      dependencies: subnet.VpcId
        ? [{ rel: 'in-vpc', id: subnet.VpcId, resourceClass: RESOURCE_CLASS.VPC }]
        : [],
      sizeGiB: 0,
      scriptedPayload: subnet,
    });
  }
  for (const sg of fixture.vpc?.securityGroups || fixture.ec2?.securityGroups || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SECURITY_GROUP,
      id: sg.GroupId,
      region,
      sizeGiB: 0,
      scriptedPayload: sg,
    });
  }
  for (const nacl of fixture.vpc?.networkAcls || fixture.ec2?.networkAcls || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.NETWORK_ACL,
      id: nacl.NetworkAclId,
      region,
      sizeGiB: 0,
      scriptedPayload: nacl,
    });
  }
  for (const table of fixture.vpc?.routeTables || fixture.ec2?.routeTables || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.ROUTE_TABLE,
      id: table.RouteTableId,
      region,
      sizeGiB: 0,
      scriptedPayload: table,
    });
  }
  for (const eip of fixture.ec2?.addresses || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.ELASTIC_IP,
      id: eip.AllocationId || eip.PublicIp,
      region,
      sizeGiB: 0,
      scriptedPayload: { AllocationId: eip.AllocationId, PublicIp: eip.PublicIp, Domain: eip.Domain },
    });
  }

  const volumeById = new Map();
  for (const volume of fixture.ec2?.volumes || []) {
    volumeById.set(volume.VolumeId, volume);
    resources.push({
      resourceClass: RESOURCE_CLASS.VOLUME,
      id: volume.VolumeId,
      region: volume.AvailabilityZone?.replace(/[a-z]$/, '') || region,
      sizeGiB: Number(volume.Size) || 0,
      encryption: {
        encrypted: Boolean(volume.Encrypted),
        kmsKeyId: volume.KmsKeyId || null,
      },
      snapshotId: volume.SnapshotId || null,
      recommendedSnapshotId: volume.RecommendedSnapshotId || null,
      pinnedSnapshotId: volume.PinnedSnapshotId || null,
      attachments: volume.Attachments || [],
      scriptedPayload: {
        VolumeId: volume.VolumeId,
        VolumeType: volume.VolumeType,
        Size: volume.Size,
        Encrypted: volume.Encrypted,
        AvailabilityZone: volume.AvailabilityZone,
        Iops: volume.Iops,
        Throughput: volume.Throughput,
        Attachments: volume.Attachments || [],
      },
    });
  }

  for (const instance of fixture.ec2?.instances || []) {
    const volumeIds = (instance.BlockDeviceMappings || [])
      .map((m) => m.Ebs?.VolumeId)
      .filter(Boolean);
    resources.push({
      resourceClass: RESOURCE_CLASS.INSTANCE,
      id: instance.InstanceId,
      region,
      instanceType: instance.InstanceType,
      tags: instance.Tags || {},
      keyName: instance.KeyName || null,
      sizeGiB: 0,
      dependencies: volumeIds.map((id) => ({
        rel: 'attached-volume',
        id,
        resourceClass: RESOURCE_CLASS.VOLUME,
      })),
      scriptedPayload: {
        InstanceId: instance.InstanceId,
        InstanceType: instance.InstanceType,
        Tags: instance.Tags || {},
        KeyName: instance.KeyName || null,
        SubnetId: instance.SubnetId,
        SecurityGroupIds: instance.SecurityGroupIds || [],
        BlockDeviceMappings: (instance.BlockDeviceMappings || []).map((m) => ({
          DeviceName: m.DeviceName,
          VolumeId: m.Ebs?.VolumeId || null,
        })),
      },
    });
  }

  for (const store of fixture.ec2?.instanceStoreVolumes || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.INSTANCE_STORE,
      id: store.VolumeId || `${store.InstanceId}:instance-store`,
      region,
      sizeGiB: Number(store.sizeGiB) || Number(store.Size) || 0,
      dependencies: store.InstanceId
        ? [{ rel: 'attached-to', id: store.InstanceId, resourceClass: RESOURCE_CLASS.INSTANCE }]
        : [],
    });
  }

  for (const snapshot of fixture.ec2?.snapshots || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SNAPSHOT,
      id: snapshot.SnapshotId,
      region: snapshot.Region || region,
      sizeGiB: Number(snapshot.VolumeSize) || Number(snapshot.sizeGiB) || 0,
      snapshotId: snapshot.SnapshotId,
      encryption: { encrypted: Boolean(snapshot.Encrypted) },
      scriptedPayload: {
        SnapshotId: snapshot.SnapshotId,
        VolumeId: snapshot.VolumeId,
        VolumeSize: snapshot.VolumeSize,
        Encrypted: snapshot.Encrypted,
      },
    });
  }

  for (const image of fixture.ec2?.images || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.AMI,
      id: image.ImageId,
      imageId: image.ImageId,
      region,
      sizeGiB: Number(image.sizeGiB) || 0,
      name: image.Name || null,
      creationDate: image.CreationDate || image.creationDate || null,
      scriptedPayload: {
        ImageId: image.ImageId,
        Name: image.Name,
        SnapshotIds: image.SnapshotIds || [],
      },
    });
  }

  for (const key of fixture.ec2?.keyPairs || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.KEY_PAIR,
      id: key.KeyName,
      region,
      sizeGiB: 0,
      scriptedPayload: { KeyName: key.KeyName, KeyType: key.KeyType || null },
    });
  }

  for (const db of fixture.rds?.instances || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.RDS_INSTANCE,
      id: db.DBInstanceIdentifier,
      region: db.AvailabilityZone?.replace(/[a-z]$/, '') || region,
      sizeGiB: Number(db.AllocatedStorage) || 0,
      engine: db.Engine,
      snapshotId: db.SnapshotId || null,
      encryption: { encrypted: Boolean(db.StorageEncrypted) },
      scriptedPayload: {
        DBInstanceIdentifier: db.DBInstanceIdentifier,
        Engine: db.Engine,
        EngineVersion: db.EngineVersion,
        AllocatedStorage: db.AllocatedStorage,
        StorageEncrypted: db.StorageEncrypted,
        DBParameterGroups: db.DBParameterGroups || [],
        OptionGroupMemberships: db.OptionGroupMemberships || [],
      },
    });
  }

  for (const fn of fixture.lambda?.functions || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.LAMBDA_FUNCTION,
      id: fn.FunctionName,
      region,
      sizeGiB: bytesToGiB(fn.CodeSize),
      scriptedPayload: {
        FunctionName: fn.FunctionName,
        Runtime: fn.Runtime,
        Handler: fn.Handler,
        MemorySize: fn.MemorySize,
        Timeout: fn.Timeout,
        Role: fn.Role,
        CodeSha256: fn.CodeSha256,
        CodeSize: fn.CodeSize,
        environmentNames: namesOnlyMap(fn.Environment?.Variables),
      },
    });
    if (fn.CodeSize > 0) {
      resources.push({
        resourceClass: RESOURCE_CLASS.LAMBDA_PACKAGE,
        id: `${fn.FunctionName}:package`,
        region,
        sizeGiB: bytesToGiB(fn.CodeSize),
        sha256: fn.CodeSha256,
        dependencies: [{ rel: 'config-of', id: fn.FunctionName, resourceClass: RESOURCE_CLASS.LAMBDA_FUNCTION }],
      });
    }
  }

  for (const bucket of fixture.s3?.buckets || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.S3_BUCKET,
      id: bucket.Name,
      region: bucket.Region || region,
      sizeGiB: 0,
      scriptedPayload: {
        Name: bucket.Name,
        Policy: bucket.Policy || null,
        Cors: bucket.Cors || null,
        Lifecycle: bucket.Lifecycle || null,
        Versioning: bucket.Versioning || null,
        Encryption: bucket.Encryption || null,
      },
    });
    const totalBytes = Number(bucket.totalBytes) || 0;
    resources.push({
      resourceClass: RESOURCE_CLASS.S3_OBJECT_BODY,
      id: `${bucket.Name}:objects`,
      region: bucket.Region || region,
      sizeGiB: bytesToGiB(totalBytes),
      objectCount: Number(bucket.objectCount) || 0,
      totalBytes,
      dependencies: [{ rel: 'body-of', id: bucket.Name, resourceClass: RESOURCE_CLASS.S3_BUCKET }],
      scriptedPayload: {
        keyInventory: bucket.keyInventory || 'counts-only',
        objectCount: Number(bucket.objectCount) || 0,
        totalBytes,
      },
    });
  }

  for (const lb of fixture.elbv2?.loadBalancers || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.ELB,
      id: lb.LoadBalancerName || lb.LoadBalancerArn,
      region,
      sizeGiB: 0,
      scriptedPayload: lb,
    });
  }
  for (const cluster of fixture.ecs?.clusters || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.ECS_CLUSTER,
      id: cluster.clusterName,
      region,
      sizeGiB: 0,
      scriptedPayload: cluster,
    });
  }
  for (const cluster of fixture.eks?.clusters || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.EKS_CLUSTER,
      id: cluster.name,
      region,
      sizeGiB: 0,
      scriptedPayload: cluster,
    });
  }
  for (const alarm of fixture.cloudwatch?.alarms || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.CW_ALARM,
      id: alarm.AlarmName,
      region,
      sizeGiB: 0,
      scriptedPayload: alarm,
    });
  }
  for (const rule of fixture.eventbridge?.rules || fixture.events?.rules || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.EVENT_RULE,
      id: rule.Name,
      region,
      sizeGiB: 0,
      scriptedPayload: rule,
    });
  }
  for (const queue of fixture.sqs?.queues || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SQS_QUEUE,
      id: queue.QueueName || queue.QueueUrl,
      region,
      sizeGiB: 0,
      scriptedPayload: queue,
    });
  }
  for (const topic of fixture.sns?.topics || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SNS_TOPIC,
      id: topic.TopicArn,
      region,
      sizeGiB: 0,
      scriptedPayload: topic,
    });
  }
  for (const secret of fixture.secretsmanager?.secrets || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SECRET,
      id: secret.Name,
      arn: secret.ARN,
      region,
      sizeGiB: 0,
      scriptedPayload: { Name: secret.Name, ARN: secret.ARN },
    });
  }
  for (const param of fixture.ssm?.parameters || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.SSM_PARAMETER,
      id: param.Name,
      region,
      sizeGiB: 0,
      scriptedPayload: { Name: param.Name, Type: param.Type },
    });
    if (param.Type === 'SecureString' && param.Value) {
      resources.push({
        resourceClass: RESOURCE_CLASS.SSM_SECURE_STRING,
        id: `${param.Name}:value`,
        region,
        sizeGiB: 0,
      });
    }
  }
  for (const zone of fixture.route53?.hostedZones || []) {
    const records = (zone.records || []).map((r) => ({
      Name: r.Name,
      Type: r.Type,
      TTL: r.TTL,
      ResourceRecords: (r.ResourceRecords || []).map((rr) =>
        r.Type === 'TXT' ? redactTxtRdata(rr) : rr,
      ),
    }));
    resources.push({
      resourceClass: RESOURCE_CLASS.ROUTE53_ZONE,
      id: zone.Id || zone.Name,
      region: 'global',
      sizeGiB: 0,
      scriptedPayload: { Name: zone.Name, Id: zone.Id, records },
    });
  }
  for (const stack of fixture.cloudformation?.stacks || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.CFN_STACK,
      id: stack.StackName,
      region,
      sizeGiB: 0,
      cdk: Boolean(stack.CdkMetadata || stack.StackName === 'CDKToolkit'),
      scriptedPayload: {
        StackName: stack.StackName,
        TemplateBodyPresent: Boolean(stack.TemplateBody),
        CdkMetadata: stack.CdkMetadata || null,
        ParametersNoEchoOmitted: true,
      },
    });
  }
  for (const table of fixture.dynamodb?.tables || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.DYNAMODB_TABLE,
      id: table.TableName,
      region,
      sizeGiB: bytesToGiB(table.TableSizeBytes),
      scriptedPayload: {
        TableName: table.TableName,
        ItemCount: table.ItemCount,
        TableSizeBytes: table.TableSizeBytes,
        BillingMode: table.BillingMode,
      },
    });
  }
  for (const key of fixture.kms?.keys || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.KMS_KEY,
      id: key.KeyId,
      region,
      sizeGiB: 0,
      scriptedPayload: { KeyId: key.KeyId, Arn: key.Arn, Alias: key.Alias || null },
    });
  }
  for (const dist of fixture.cloudfront?.distributions || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.CLOUDFRONT,
      id: dist.Id,
      region: 'global',
      sizeGiB: 0,
      scriptedPayload: { Id: dist.Id, DomainName: dist.DomainName, Enabled: dist.Enabled },
    });
  }
  for (const pool of fixture.cognito?.userPools || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.COGNITO_USER_POOL,
      id: pool.Id,
      region,
      sizeGiB: 0,
      scriptedPayload: { Id: pool.Id, Name: pool.Name },
    });
  }
  for (const repo of fixture.ecr?.repositories || []) {
    resources.push({
      resourceClass: RESOURCE_CLASS.ECR_REPOSITORY,
      id: repo.repositoryName,
      region,
      sizeGiB: 0,
      scriptedPayload: { repositoryName: repo.repositoryName, encryption: repo.encryption },
    });
    for (const image of repo.images || []) {
      resources.push({
        resourceClass: RESOURCE_CLASS.ECR_IMAGE,
        id: `${repo.repositoryName}@${image.digest}`,
        region,
        sizeGiB: bytesToGiB(image.sizeBytes),
        digest: image.digest,
        tags: image.tags || [],
        dependencies: [{ rel: 'in-repo', id: repo.repositoryName, resourceClass: RESOURCE_CLASS.ECR_REPOSITORY }],
      });
    }
  }

  const edges = [];
  for (const resource of resources) {
    for (const dep of resource.dependencies || []) {
      edges.push({
        from: { id: resource.id, resourceClass: resource.resourceClass },
        rel: dep.rel,
        to: { id: dep.id, resourceClass: dep.resourceClass },
      });
    }
  }

  const latestBackups = resolveAccountLatestBackups({
    snapshots: fixture.ec2?.snapshots || [],
    images: fixture.ec2?.images || [],
    volumes: fixture.ec2?.volumes || [],
    s3Objects: collectS3ObjectsFromFixture(fixture),
  });

  for (const resource of resources) {
    if (resource.resourceClass === RESOURCE_CLASS.VOLUME) {
      const latest = latestForVolume(latestBackups, resource.id);
      if (latest?.snapshotId) {
        resource.recommendedSnapshotId = latest.snapshotId;
        resource.latestSnapshotId = latest.snapshotId;
        resource.latestSnapshotStartTime = latest.startTime || null;
        resource.latestBackupPolicy = latest.policy;
        resource.pinnedRefused = Boolean(latest.pinnedRefused);
        if (latest.warning) resource.latestBackupWarning = latest.warning;
      } else {
        resource.latestSnapshotId = null;
        resource.latestBackupPolicy = latest?.policy || 'most_recent';
      }
    }
    if (resource.resourceClass === RESOURCE_CLASS.AMI) {
      const name = resource.name || resource.scriptedPayload?.Name || '';
      const series = (latestBackups.amis || []).find((row) =>
        row.prefix && name.startsWith(row.prefix),
      );
      if (series) {
        resource.seriesPrefix = series.prefix;
        resource.latestImageIdInSeries = series.amiId;
        resource.isMostRecentInSeries = series.amiId === resource.imageId;
      } else {
        resource.isMostRecentInSeries = Boolean(resource.imageId);
        resource.latestImageIdInSeries = resource.imageId || null;
      }
    }
    if (resource.resourceClass === RESOURCE_CLASS.SNAPSHOT) {
      const vol = latestForVolume(latestBackups, resource.scriptedPayload?.VolumeId);
      resource.isMostRecentForVolume = Boolean(vol?.snapshotId && vol.snapshotId === resource.id);
    }
  }

  void client;
  return {
    schemaVersion: AWS_INVENTORY_SCHEMA_VERSION,
    account: {
      accountId,
      aliases: fixture.aliases || [],
      partition: fixture.partition || 'aws',
    },
    regions,
    resources,
    edges,
    latestBackups,
  };
}

export function estimateScriptedBytes(inventory) {
  const scripted = (inventory.resources || []).filter((r) => r.scriptedPayload);
  return Buffer.byteLength(JSON.stringify(scripted), 'utf8');
}

export function sumBinaryGiB(inventory) {
  const binaryClasses = new Set([
    RESOURCE_CLASS.VOLUME,
    RESOURCE_CLASS.INSTANCE_STORE,
    RESOURCE_CLASS.S3_OBJECT_BODY,
    RESOURCE_CLASS.ECR_IMAGE,
    RESOURCE_CLASS.LAMBDA_PACKAGE,
    RESOURCE_CLASS.RDS_INSTANCE,
    RESOURCE_CLASS.RDS_CLUSTER,
    RESOURCE_CLASS.AMI,
  ]);
  return (inventory.resources || [])
    .filter((r) => binaryClasses.has(r.resourceClass))
    .reduce((sum, r) => sum + (Number(r.sizeGiB) || 0), 0);
}
