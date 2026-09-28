/**
 * AWS CLI allowlist for a future live collector.
 *
 * This PR never shells out to `aws` against a real account. The allowlist
 * exists so unit tests can prove CreateSnapshot / mutate verbs are refused
 * even if someone later wires a runner.
 */

export const AWS_CLI_ALLOWED = Object.freeze([
  'sts get-caller-identity',
  'iam list-users',
  'iam list-roles',
  'iam list-policies',
  'iam list-instance-profiles',
  'iam list-account-aliases',
  'ec2 describe-instances',
  'ec2 describe-volumes',
  'ec2 describe-snapshots',
  'ec2 describe-images',
  'ec2 describe-vpcs',
  'ec2 describe-subnets',
  'ec2 describe-security-groups',
  'ec2 describe-network-acls',
  'ec2 describe-route-tables',
  'ec2 describe-key-pairs',
  'ec2 describe-addresses',
  'rds describe-db-instances',
  'rds describe-db-clusters',
  'rds describe-db-snapshots',
  's3api list-buckets',
  's3api get-bucket-location',
  's3api get-bucket-versioning',
  's3api list-objects-v2',
  'lambda list-functions',
  'secretsmanager list-secrets',
  'ssm describe-parameters',
  'ecr describe-repositories',
  'ecr describe-images',
  'cloudformation list-stacks',
  'cloudformation describe-stacks',
]);

export const AWS_CLI_FORBIDDEN = Object.freeze([
  'ec2 create-snapshot',
  'ec2 create-snapshots',
  'ec2 create-image',
  'ec2 create-volume',
  'ec2 run-instances',
  'ec2 terminate-instances',
  'rds create-db-snapshot',
  'rds copy-db-snapshot',
  's3 cp',
  's3 sync',
  's3api get-object',
  's3api put-object',
  'secretsmanager get-secret-value',
  'ssm get-parameter',
  'iam create-access-key',
]);

function normalizeAwsCli(service, verb) {
  return `${String(service || '').trim()} ${String(verb || '').trim()}`.replace(/\s+/g, ' ').toLowerCase();
}

export function isAllowedAwsCli(service, verb) {
  return AWS_CLI_ALLOWED.includes(normalizeAwsCli(service, verb));
}

export function isForbiddenAwsCli(service, verb) {
  const token = normalizeAwsCli(service, verb);
  if (AWS_CLI_FORBIDDEN.includes(token)) return true;
  const verbOnly = String(verb || '').toLowerCase();
  return /^(create|delete|put|update|modify|terminate|start|stop|run|copy|replicate)-/.test(verbOnly)
    || verbOnly === 'get-object'
    || verbOnly === 'get-secret-value'
    || verbOnly === 'get-parameter'
    || verbOnly === 'cp'
    || verbOnly === 'sync';
}

/**
 * Refuse mutating AWS CLI invocations. Does not execute anything.
 * @returns {true} when the command is read-only and allowlisted
 */
export function assertReadOnlyAwsCli(service, verb) {
  const token = normalizeAwsCli(service, verb);
  if (isForbiddenAwsCli(service, verb)) {
    throw new Error(
      `Refused aws ${token}: AWS capsule V2 is read-only and will not create snapshots or mutate an account.`,
    );
  }
  if (!isAllowedAwsCli(service, verb)) {
    throw new Error(
      `Refused aws ${token}: not on the read-only inventory allowlist. Use --fixture <json>.`,
    );
  }
  return true;
}
