/**
 * Binary vs scripted decision tree for AWS resources.
 *
 * Default profile: exclude-binaries. Scripted/API-describable config is copied
 * into the capsule. Opaque blobs are inventoried and given a recommended
 * continuity path — they are not dumped into .pbase.
 */

export const ACTIONS = Object.freeze({
  PACK_SCRIPTED: 'pack-scripted',
  RECOMMEND_SNAPSHOT: 'recommend-snapshot',
  RECOMMEND_AMI: 'recommend-ami',
  RECOMMEND_RDS_SNAPSHOT: 'recommend-rds-snapshot',
  RECOMMEND_ECR_REPLICATION: 'recommend-ecr-replication',
  EXCLUDE_BINARIES: 'exclude-binaries',
  INVENTORY_ONLY: 'inventory-only',
  NEVER_PACK: 'never-pack',
  WILL_FAIL: 'will-fail',
});

/** Size gates applied after the resource-class tree. Bytes are measured, not guessed. */
export const SIZE_POLICY = Object.freeze({
  scriptedCopyMaxBytes: 16 * 1024 * 1024,
  scriptedWarnMaxBytes: 100 * 1024 * 1024,
  binaryDumpFailGiB: 1,
  unmeasuredVolumeFails: true,
});

const GIB = 1024 ** 3;

function scriptedPayloadBytes(resource) {
  if (!resource?.scriptedPayload) return 0;
  try {
    return Buffer.byteLength(JSON.stringify(resource.scriptedPayload), 'utf8');
  } catch {
    return 0;
  }
}

function measuredGiB(resource) {
  if (resource?.sizeGiB != null && Number.isFinite(Number(resource.sizeGiB))) {
    return Number(resource.sizeGiB);
  }
  if (resource?.sizeBytes != null && Number.isFinite(Number(resource.sizeBytes))) {
    return Number(resource.sizeBytes) / GIB;
  }
  return null;
}

/**
 * Overlay size measurement on a class-level decision.
 * Dumping binary bytes into the capsule is always will-fail in this format version.
 */
export function applySizePolicy(decision, resource) {
  if (!decision || typeof decision !== 'object') return fail('decision is required');
  const next = { ...decision, restoreBlockers: [...(decision.restoreBlockers || [])] };
  const scriptedBytes = scriptedPayloadBytes(resource);
  const sizeGiB = measuredGiB(resource);
  next.measured = {
    scriptedBytes,
    sizeGiB,
    dumpBytesRequested: resource?.dumpBytes === true || resource?.wouldCopyBytes === true,
  };

  if (next.measured.dumpBytesRequested) {
    next.action = ACTIONS.WILL_FAIL;
    next.finding = 'will-fail';
    next.inCapsule = false;
    next.coverage = 'blocked';
    next.reason = 'Binary byte dump into the capsule is refused. Inventory the object and recommend a customer-owned snapshot or copy job.';
    next.restoreBlockers.push('binary-dump-refused');
    return next;
  }

  if (next.action === ACTIONS.PACK_SCRIPTED && scriptedBytes > SIZE_POLICY.scriptedWarnMaxBytes) {
    next.finding = 'will-fail';
    next.reason = `Scripted payload is ${scriptedBytes} bytes (> ${SIZE_POLICY.scriptedWarnMaxBytes}). Too large to pack as JSON; inventory only.`;
    next.restoreBlockers.push('scripted-payload-too-large');
    next.inCapsule = false;
    next.coverage = 'blocked';
    return next;
  }
  if (next.action === ACTIONS.PACK_SCRIPTED && scriptedBytes > SIZE_POLICY.scriptedCopyMaxBytes) {
    next.finding = 'will-warn';
    next.reason = `Scripted payload is ${scriptedBytes} bytes (> ${SIZE_POLICY.scriptedCopyMaxBytes}). Will copy with a size warning.`;
    next.restoreBlockers.push('scripted-payload-large');
    return next;
  }

  if (
    resource?.resourceClass === RESOURCE_CLASS.VOLUME
    && SIZE_POLICY.unmeasuredVolumeFails
    && (sizeGiB == null)
  ) {
    next.finding = 'will-fail';
    next.reason = 'EBS volume has no measured Size (GiB). Doctor cannot recommend a snapshot without a size.';
    next.restoreBlockers.push('unmeasured-volume');
    return next;
  }

  return next;
}

export const RESOURCE_CLASS = Object.freeze({
  ACCOUNT: 'AWS::Account',
  IAM_USER: 'AWS::IAM::User',
  IAM_ROLE: 'AWS::IAM::Role',
  IAM_POLICY: 'AWS::IAM::Policy',
  IAM_INSTANCE_PROFILE: 'AWS::IAM::InstanceProfile',
  VPC: 'AWS::EC2::VPC',
  SUBNET: 'AWS::EC2::Subnet',
  SECURITY_GROUP: 'AWS::EC2::SecurityGroup',
  NETWORK_ACL: 'AWS::EC2::NetworkAcl',
  ROUTE_TABLE: 'AWS::EC2::RouteTable',
  INTERNET_GATEWAY: 'AWS::EC2::InternetGateway',
  NAT_GATEWAY: 'AWS::EC2::NatGateway',
  VPC_ENDPOINT: 'AWS::EC2::VPCEndpoint',
  INSTANCE: 'AWS::EC2::Instance',
  VOLUME: 'AWS::EC2::Volume',
  INSTANCE_STORE: 'AWS::EC2::InstanceStoreVolume',
  SNAPSHOT: 'AWS::EC2::Snapshot',
  AMI: 'AWS::EC2::Image',
  LAUNCH_TEMPLATE: 'AWS::EC2::LaunchTemplate',
  KEY_PAIR: 'AWS::EC2::KeyPair',
  ASG: 'AWS::AutoScaling::AutoScalingGroup',
  RDS_INSTANCE: 'AWS::RDS::DBInstance',
  RDS_CLUSTER: 'AWS::RDS::DBCluster',
  RDS_PARAM_GROUP: 'AWS::RDS::DBParameterGroup',
  LAMBDA_FUNCTION: 'AWS::Lambda::Function',
  LAMBDA_PACKAGE: 'AWS::Lambda::DeploymentPackage',
  S3_BUCKET: 'AWS::S3::Bucket',
  S3_OBJECT_BODY: 'AWS::S3::ObjectBody',
  ELB: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
  ECS_CLUSTER: 'AWS::ECS::Cluster',
  EKS_CLUSTER: 'AWS::EKS::Cluster',
  CW_ALARM: 'AWS::CloudWatch::Alarm',
  EVENT_RULE: 'AWS::Events::Rule',
  SQS_QUEUE: 'AWS::SQS::Queue',
  SNS_TOPIC: 'AWS::SNS::Topic',
  SECRET: 'AWS::SecretsManager::Secret',
  SECRET_VALUE: 'AWS::SecretsManager::SecretValue',
  SSM_PARAMETER: 'AWS::SSM::Parameter',
  SSM_SECURE_STRING: 'AWS::SSM::SecureStringValue',
  ROUTE53_ZONE: 'AWS::Route53::HostedZone',
  CFN_STACK: 'AWS::CloudFormation::Stack',
  ECR_REPOSITORY: 'AWS::ECR::Repository',
  ECR_IMAGE: 'AWS::ECR::Image',
  DYNAMODB_TABLE: 'AWS::DynamoDB::Table',
  KMS_KEY: 'AWS::KMS::Key',
  CLOUDFRONT: 'AWS::CloudFront::Distribution',
  COGNITO_USER_POOL: 'AWS::Cognito::UserPool',
  ELASTIC_IP: 'AWS::EC2::EIP',
});

/**
 * @typedef {object} Decision
 * @property {string} action
 * @property {'will-copy'|'will-warn'|'will-fail'} finding
 * @property {string} reason
 * @property {string} coverage
 * @property {boolean} inCapsule
 * @property {string|null} recommendedPath
 * @property {string[]} restoreBlockers
 */

/**
 * Classify one normalized inventory resource.
 * @param {object} resource
 * @returns {Decision}
 */
export function decideBinaryPath(resource) {
  return applySizePolicy(classifyResource(resource), resource);
}

function classifyResource(resource) {
  if (!resource || typeof resource !== 'object') {
    return fail('resource is required', 'missing-resource');
  }
  const cls = resource.resourceClass;
  const sizeGiB = Number(resource.sizeGiB) || 0;

  switch (cls) {
    case RESOURCE_CLASS.ACCOUNT:
    case RESOURCE_CLASS.IAM_USER:
    case RESOURCE_CLASS.IAM_ROLE:
    case RESOURCE_CLASS.IAM_POLICY:
    case RESOURCE_CLASS.IAM_INSTANCE_PROFILE:
    case RESOURCE_CLASS.VPC:
    case RESOURCE_CLASS.SUBNET:
    case RESOURCE_CLASS.SECURITY_GROUP:
    case RESOURCE_CLASS.NETWORK_ACL:
    case RESOURCE_CLASS.ROUTE_TABLE:
    case RESOURCE_CLASS.INTERNET_GATEWAY:
    case RESOURCE_CLASS.NAT_GATEWAY:
    case RESOURCE_CLASS.VPC_ENDPOINT:
    case RESOURCE_CLASS.LAUNCH_TEMPLATE:
    case RESOURCE_CLASS.ASG:
    case RESOURCE_CLASS.CW_ALARM:
    case RESOURCE_CLASS.EVENT_RULE:
    case RESOURCE_CLASS.SQS_QUEUE:
    case RESOURCE_CLASS.SNS_TOPIC:
    case RESOURCE_CLASS.ELB:
    case RESOURCE_CLASS.ECS_CLUSTER:
    case RESOURCE_CLASS.EKS_CLUSTER:
    case RESOURCE_CLASS.ROUTE53_ZONE:
    case RESOURCE_CLASS.CFN_STACK:
    case RESOURCE_CLASS.RDS_PARAM_GROUP:
    case RESOURCE_CLASS.DYNAMODB_TABLE:
    case RESOURCE_CLASS.KMS_KEY:
    case RESOURCE_CLASS.CLOUDFRONT:
    case RESOURCE_CLASS.COGNITO_USER_POOL:
    case RESOURCE_CLASS.ELASTIC_IP:
      return copyScripted('API-describable configuration is packed as JSON.');

    case RESOURCE_CLASS.INSTANCE:
      return copyScripted(
        'Instance description, type, tags, and block-device volume IDs are packed. Disk bytes are not.',
      );

    case RESOURCE_CLASS.KEY_PAIR:
      return copyScripted('Key-pair names only. Private key material is never packed.');

    case RESOURCE_CLASS.VOLUME: {
      const encrypted = resource.encryption?.encrypted !== false;
      const latestId = resource.latestSnapshotId || resource.recommendedSnapshotId || resource.snapshotId;
      if (latestId) {
        return {
          action: ACTIONS.RECOMMEND_SNAPSHOT,
          finding: 'will-copy',
          reason: `Most recent completed EBS snapshot ${latestId} is referenced from the capsule; volume bytes stay in AWS snapshot storage. Portabase never holds the bytes.`,
          coverage: 'binary-reference',
          inCapsule: false,
          recommendedPath: 'reference-latest-completed-snapshot',
          restoreBlockers: encrypted ? [] : ['volume-unencrypted'],
        };
      }
      return {
        action: ACTIONS.RECOMMEND_SNAPSHOT,
        finding: 'will-warn',
        reason: 'No completed recent snapshot exists for this volume. Prefer CreateSnapshot only after latest-snapshot resolve finds none. This CLI will not create it.',
        coverage: 'excluded',
        inCapsule: false,
        recommendedPath: 'ec2-create-snapshot',
        restoreBlockers: [
          'no-approved-snapshot',
          ...(encrypted ? [] : ['volume-unencrypted']),
          ...(sizeGiB <= 0 ? ['missing-size'] : []),
        ],
      };
    }

    case RESOURCE_CLASS.INSTANCE_STORE:
      return {
        action: ACTIONS.WILL_FAIL,
        finding: 'will-fail',
        reason: 'Instance store is ephemeral and cannot be snapshotted. Treat as a restore blocker.',
        coverage: 'blocked',
        inCapsule: false,
        recommendedPath: null,
        restoreBlockers: ['instance-store-ephemeral'],
      };

    case RESOURCE_CLASS.SNAPSHOT:
      return {
        action: ACTIONS.RECOMMEND_SNAPSHOT,
        finding: 'will-copy',
        reason: 'Existing snapshot metadata (id, region, volume map, encryption) is referenced — not re-copied as raw disk.',
        coverage: 'binary-reference',
        inCapsule: false,
        recommendedPath: 'ec2-create-snapshot',
        restoreBlockers: [],
      };

    case RESOURCE_CLASS.AMI: {
      const latestInSeries = resource.latestImageIdInSeries;
      const isLatest = !latestInSeries || latestInSeries === resource.imageId || resource.isMostRecentInSeries !== false;
      if (resource.imageId && isLatest) {
        return {
          action: ACTIONS.RECOMMEND_AMI,
          finding: 'will-copy',
          reason: `Most recent completed AMI ${resource.imageId} is referenced (id + snapshot map only). Bytes stay out of .pbase.`,
          coverage: 'binary-reference',
          inCapsule: false,
          recommendedPath: 'reference-latest-completed-ami',
          restoreBlockers: [],
        };
      }
      if (resource.imageId && !isLatest) {
        return {
          action: ACTIONS.RECOMMEND_AMI,
          finding: 'will-warn',
          reason: `Older AMI ${resource.imageId} is ignored. Capsule references most recent in series (${latestInSeries}).`,
          coverage: 'excluded',
          inCapsule: false,
          recommendedPath: 'reference-latest-completed-ami',
          restoreBlockers: ['older-ami-in-series'],
        };
      }
      return {
        action: ACTIONS.RECOMMEND_AMI,
        finding: 'will-warn',
        reason: 'AMI is the continuity unit when the instance image (not a single volume) must be rebuilt. Capsule stores image id + snapshot map, not AMI bytes.',
        coverage: 'excluded',
        inCapsule: false,
        recommendedPath: 'ec2-create-image',
        restoreBlockers: ['no-ami-id'],
      };
    }

    case RESOURCE_CLASS.RDS_INSTANCE:
    case RESOURCE_CLASS.RDS_CLUSTER:
      return {
        action: ACTIONS.RECOMMEND_RDS_SNAPSHOT,
        finding: resource.snapshotId ? 'will-copy' : 'will-warn',
        reason: 'RDS/Aurora descriptions and allocated storage are scripted. Row data is a follow-on; prefer an AWS RDS snapshot referenced from the manifest.',
        coverage: resource.snapshotId ? 'binary-reference' : 'excluded',
        inCapsule: false,
        recommendedPath: 'rds-create-snapshot',
        restoreBlockers: resource.snapshotId ? [] : ['rds-rows-not-in-capsule-v1'],
      };

    case RESOURCE_CLASS.LAMBDA_FUNCTION:
      return copyScripted('Function configuration, name, CodeSha256, and CodeSize are packed. Environment values are names-only.');

    case RESOURCE_CLASS.LAMBDA_PACKAGE:
      return {
        action: ACTIONS.EXCLUDE_BINARIES,
        finding: 'will-warn',
        reason: 'Lambda deployment package (opaque zip/image) is excluded by default. Configuration + SHA/size stay in the scripted layer; source zip is optional later.',
        coverage: 'excluded',
        inCapsule: false,
        recommendedPath: 'optional-later-source-zip',
        restoreBlockers: ['lambda-package-bytes-excluded'],
      };

    case RESOURCE_CLASS.S3_BUCKET:
      return copyScripted('Bucket policy, CORS, lifecycle, versioning, and encryption config are packed. Object key inventory is separate.');

    case RESOURCE_CLASS.S3_OBJECT_BODY:
      return {
        action: ACTIONS.EXCLUDE_BINARIES,
        finding: 'will-warn',
        reason: 'S3 object bodies are binaries. Default is inventory (keys, counts, bytes) plus a later customer-owned copy job — not inside .pbase.',
        coverage: 'excluded',
        inCapsule: false,
        recommendedPath: 'optional-customer-copy-job',
        restoreBlockers: ['s3-object-bytes-excluded'],
      };

    case RESOURCE_CLASS.ECR_REPOSITORY:
      return copyScripted('Repository name, encryption, and scan settings are packed.');

    case RESOURCE_CLASS.ECR_IMAGE:
      return {
        action: ACTIONS.RECOMMEND_ECR_REPLICATION,
        finding: 'will-warn',
        reason: 'ECR image layers are binaries. Inventory digests/tags/sizes; recommend ECR replication or skopeo to a customer registry.',
        coverage: 'excluded',
        inCapsule: false,
        recommendedPath: 'ecr-replication-or-skopeo',
        restoreBlockers: ['ecr-layers-excluded'],
      };

    case RESOURCE_CLASS.SECRET:
      return copyScripted('Secrets Manager names and ARNs only.');

    case RESOURCE_CLASS.SECRET_VALUE:
      return neverPack('Secrets Manager secret values are never packed.');

    case RESOURCE_CLASS.SSM_PARAMETER:
      return copyScripted('SSM parameter names and types only.');

    case RESOURCE_CLASS.SSM_SECURE_STRING:
      return neverPack('SSM SecureString values are never packed.');

    default:
      return {
        action: ACTIONS.INVENTORY_ONLY,
        finding: 'will-warn',
        reason: `No decision rule for ${cls || 'unknown'}. Inventoried as not-covered until a collector exists.`,
        coverage: 'excluded',
        inCapsule: false,
        recommendedPath: null,
        restoreBlockers: ['unknown-resource-class'],
      };
  }
}

function copyScripted(reason) {
  return {
    action: ACTIONS.PACK_SCRIPTED,
    finding: 'will-copy',
    reason,
    coverage: 'scripted',
    inCapsule: true,
    recommendedPath: null,
    restoreBlockers: [],
  };
}

function neverPack(reason) {
  return {
    action: ACTIONS.NEVER_PACK,
    finding: 'will-fail',
    reason,
    coverage: 'blocked',
    inCapsule: false,
    recommendedPath: null,
    restoreBlockers: ['secret-value-forbidden'],
  };
}

function fail(reason) {
  return {
    action: ACTIONS.WILL_FAIL,
    finding: 'will-fail',
    reason,
    coverage: 'blocked',
    inCapsule: false,
    recommendedPath: null,
    restoreBlockers: ['invalid-resource'],
  };
}

/** Apply the tree to a list of normalized resources. */
export function decideAll(resources) {
  return (resources || []).map((resource) => ({
    resource,
    decision: decideBinaryPath(resource),
  }));
}
