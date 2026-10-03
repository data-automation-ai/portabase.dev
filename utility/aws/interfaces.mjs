/**
 * Read-only, boto3-shaped collector contracts.
 *
 * Method names match boto3 so a later Python adapter or AWS SDK v3 wrapper
 * can implement the same surface. This scaffold never ships live clients
 * and never exposes mutating APIs as callable inventory paths.
 */

export const COLLECTOR_MODE = 'read-only';

/** Mutating boto3 APIs that collectors must refuse. */
export const FORBIDDEN_MUTATIONS = Object.freeze([
  'create_snapshot',
  'create_snapshots',
  'copy_snapshot',
  'create_image',
  'register_image',
  'run_instances',
  'start_instances',
  'stop_instances',
  'terminate_instances',
  'create_volume',
  'delete_volume',
  'modify_volume',
  'create_db_snapshot',
  'copy_db_snapshot',
  'create_db_cluster_snapshot',
  'put_object',
  'delete_object',
  'put_secret_value',
  'create_secret',
  'put_parameter',
  'create_access_key',
  'update_access_key',
  'delete_access_key',
  'create_login_profile',
  'put_user_policy',
  'attach_user_policy',
  'create_repository',
  'put_image',
  'batch_delete_image',
  'create_stack',
  'update_stack',
  'delete_stack',
  'replicate_repository',
]);

export const COLLECTOR_CONTRACTS = Object.freeze({
  sts: {
    mode: COLLECTOR_MODE,
    methods: ['get_caller_identity'],
    never: FORBIDDEN_MUTATIONS,
  },
  iam: {
    mode: COLLECTOR_MODE,
    methods: [
      'list_account_aliases',
      'list_users',
      'list_roles',
      'list_policies',
      'list_instance_profiles',
      'list_access_keys',
      'get_policy_version',
      'list_attached_role_policies',
      'list_attached_user_policies',
    ],
    never: ['create_access_key', 'update_access_key', 'delete_access_key', 'create_login_profile'],
    pack: 'exportable JSON; access key IDs only; never SecretAccessKey',
  },
  ec2: {
    mode: COLLECTOR_MODE,
    methods: [
      'describe_instances',
      'describe_volumes',
      'describe_snapshots',
      'describe_images',
      'describe_vpcs',
      'describe_subnets',
      'describe_security_groups',
      'describe_network_acls',
      'describe_route_tables',
      'describe_internet_gateways',
      'describe_nat_gateways',
      'describe_vpc_endpoints',
      'describe_launch_templates',
      'describe_key_pairs',
      'describe_addresses',
    ],
    never: [
      'create_snapshot',
      'create_snapshots',
      'create_image',
      'run_instances',
      'create_volume',
      'modify_volume',
    ],
    pack: 'descriptions, volume IDs, key-pair names; never private keys or disk bytes',
  },
  autoscaling: {
    mode: COLLECTOR_MODE,
    methods: ['describe_auto_scaling_groups', 'describe_launch_configurations'],
    never: FORBIDDEN_MUTATIONS,
  },
  rds: {
    mode: COLLECTOR_MODE,
    methods: [
      'describe_db_instances',
      'describe_db_clusters',
      'describe_db_parameter_groups',
      'describe_db_cluster_parameter_groups',
      'describe_db_snapshots',
      'describe_db_cluster_snapshots',
      'describe_option_groups',
    ],
    never: ['create_db_snapshot', 'copy_db_snapshot', 'create_db_cluster_snapshot'],
    pack: 'instance/cluster + parameter/option descriptions; allocated storage measurement; no row data in V1',
  },
  lambda: {
    mode: COLLECTOR_MODE,
    methods: ['list_functions', 'get_function_configuration', 'list_layers'],
    never: FORBIDDEN_MUTATIONS,
    pack: 'configuration + CodeSha256/CodeSize; environment names only; zip optional later',
  },
  s3: {
    mode: COLLECTOR_MODE,
    methods: [
      'list_buckets',
      'get_bucket_location',
      'get_bucket_policy',
      'get_bucket_cors',
      'get_bucket_lifecycle_configuration',
      'get_bucket_versioning',
      'get_bucket_encryption',
      'get_public_access_block',
      'list_objects_v2',
    ],
    never: ['put_object', 'delete_object', 'get_object'],
    pack: 'bucket configs + object key inventory/counts; object bytes excluded by default',
    note: 'list_objects_v2 is metadata (keys, sizes, etags), not body bytes. get_object is forbidden.',
  },
  elbv2: {
    mode: COLLECTOR_MODE,
    methods: ['describe_load_balancers', 'describe_target_groups', 'describe_listeners', 'describe_rules'],
    never: FORBIDDEN_MUTATIONS,
  },
  ecs: {
    mode: COLLECTOR_MODE,
    methods: ['list_clusters', 'describe_clusters', 'list_services', 'describe_services', 'describe_task_definition'],
    never: FORBIDDEN_MUTATIONS,
  },
  eks: {
    mode: COLLECTOR_MODE,
    methods: ['list_clusters', 'describe_cluster', 'list_nodegroups', 'describe_nodegroup'],
    never: FORBIDDEN_MUTATIONS,
  },
  cloudwatch: {
    mode: COLLECTOR_MODE,
    methods: ['describe_alarms'],
    never: FORBIDDEN_MUTATIONS,
  },
  events: {
    mode: COLLECTOR_MODE,
    methods: ['list_rules', 'describe_rule', 'list_targets_by_rule'],
    never: FORBIDDEN_MUTATIONS,
  },
  sqs: {
    mode: COLLECTOR_MODE,
    methods: ['list_queues', 'get_queue_attributes'],
    never: FORBIDDEN_MUTATIONS,
  },
  sns: {
    mode: COLLECTOR_MODE,
    methods: ['list_topics', 'get_topic_attributes', 'list_subscriptions'],
    never: FORBIDDEN_MUTATIONS,
  },
  secretsmanager: {
    mode: COLLECTOR_MODE,
    methods: ['list_secrets'],
    never: ['get_secret_value', 'put_secret_value', 'create_secret'],
    pack: 'names and ARNs only',
  },
  ssm: {
    mode: COLLECTOR_MODE,
    methods: ['describe_parameters'],
    never: ['get_parameter', 'get_parameters', 'get_parameters_by_path', 'put_parameter'],
    pack: 'parameter names + type; SecureString values excluded',
  },
  route53: {
    mode: COLLECTOR_MODE,
    methods: ['list_hosted_zones', 'list_resource_record_sets'],
    never: FORBIDDEN_MUTATIONS,
    pack: 'zones + records; TXT values scanned and redacted when secret-shaped',
  },
  cloudformation: {
    mode: COLLECTOR_MODE,
    methods: ['list_stacks', 'get_template', 'describe_stacks', 'list_stack_resources'],
    never: ['create_stack', 'update_stack', 'delete_stack'],
    pack: 'templates that exist; NoEcho parameters omitted; CDK metadata if present',
  },
  ecr: {
    mode: COLLECTOR_MODE,
    methods: ['describe_repositories', 'describe_images', 'list_images'],
    never: ['put_image', 'batch_delete_image', 'create_repository', 'replicate_repository'],
    pack: 'digests/tags/sizes; recommend replication or skopeo — not inside .pbase',
  },
  dynamodb: {
    mode: COLLECTOR_MODE,
    methods: ['list_tables', 'describe_table'],
    never: ['put_item', 'batch_write_item', 'delete_item', 'scan'],
    pack: 'table name, item count, size bytes, billing mode — not row data',
  },
  kms: {
    mode: COLLECTOR_MODE,
    methods: ['list_keys', 'list_aliases', 'describe_key'],
    never: ['create_key', 'schedule_key_deletion', 'put_key_policy', 'encrypt', 'decrypt'],
    pack: 'key ids and aliases only — never key material',
  },
  cloudfront: {
    mode: COLLECTOR_MODE,
    methods: ['list_distributions', 'get_distribution_config'],
    never: FORBIDDEN_MUTATIONS,
  },
  cognitoidp: {
    mode: COLLECTOR_MODE,
    methods: ['list_user_pools', 'describe_user_pool'],
    never: FORBIDDEN_MUTATIONS,
    pack: 'pool ids and names only',
  },
});

export function listCollectorServices() {
  return Object.keys(COLLECTOR_CONTRACTS);
}

export function isForbiddenMutation(method) {
  return FORBIDDEN_MUTATIONS.includes(method);
}

function refuseMutation(service, method) {
  return async function refused() {
    throw new Error(
      `Refused ${service}.${method}: AWS capsule V2 collectors are read-only and this scaffold never mutates an account.`,
    );
  };
}

/**
 * Build a boto3-shaped client from a fixture document.
 * Read methods return fixture slices. Mutation methods throw.
 */
export function createFixtureClient(fixture) {
  if (!fixture || typeof fixture !== 'object') {
    throw new Error('createFixtureClient requires a fixture object.');
  }
  const client = {};
  for (const [service, contract] of Object.entries(COLLECTOR_CONTRACTS)) {
    const slice = fixture.clients?.[service] || fixture[service] || {};
    const api = {};
    for (const method of contract.methods) {
      api[method] = async (params = {}) => {
        if (typeof slice[method] === 'function') return slice[method](params);
        if (slice[method] !== undefined) return slice[method];
        return defaultEmpty(service, method, fixture, params);
      };
    }
    for (const method of contract.never || []) {
      api[method] = refuseMutation(service, method);
    }
    client[service] = api;
  }
  return Object.freeze(client);
}

function defaultEmpty(service, method, fixture, params) {
  if (service === 'sts' && method === 'get_caller_identity') {
    return {
      Account: fixture.accountId,
      Arn: `arn:aws:iam::${fixture.accountId}:user/fixture`,
      UserId: 'AIDAFIXTURE',
    };
  }
  if (service === 'iam' && method === 'list_account_aliases') {
    return { AccountAliases: fixture.aliases || [] };
  }
  if (Array.isArray(fixture[service])) return { items: fixture[service] };
  if (params?.Bucket && sliceHasBucket(fixture, params.Bucket)) {
    return fixture.s3.buckets.find((b) => b.Name === params.Bucket);
  }
  return {};
}

function sliceHasBucket(fixture, name) {
  return Array.isArray(fixture?.s3?.buckets) && fixture.s3.buckets.some((b) => b.Name === name);
}

/**
 * Live AWS clients are intentionally not constructed.
 * Even with credentials present, this scaffold will not call an account.
 */
export function createLiveClient() {
  throw new Error(
    'Live AWS API collection is not enabled in the V2 scaffold (--live mutate refused). The runner may hold AWS credentials locally; this build will not call your account. Use --fixture <json> or wait for Combo live-read.',
  );
}

/**
 * Verify a client is genuinely read-only: every forbidden-mutation method it
 * exposes must refuse when invoked (sync throw or rejected promise). A method
 * that executes without throwing fails the assertion.
 *
 * Safe to probe only because this scaffold never builds live clients —
 * createLiveClient() throws, so anything reaching this guard is fixture-built.
 */
export async function assertReadOnlyClient(client) {
  if (!client || typeof client !== 'object') {
    throw new Error('collector client is required');
  }
  const probe = async (service, method, fn) => {
    try {
      await fn({});
    } catch {
      return; // refusal is the required behavior
    }
    throw new Error(
      `Client violation: ${service}.${method} is a forbidden mutation but executed without throwing. Read-only collectors must refuse it.`,
    );
  };
  for (const [service, api] of Object.entries(client)) {
    if (!api || typeof api !== 'object') continue;
    for (const [method, fn] of Object.entries(api)) {
      if (typeof fn !== 'function' || !isForbiddenMutation(method)) continue;
      await probe(service, method, fn);
    }
    const contract = COLLECTOR_CONTRACTS[service];
    if (!contract) continue;
    for (const method of contract.never || []) {
      const fn = api[method];
      if (typeof fn !== 'function') continue;
      await probe(service, method, fn);
    }
  }
  return true;
}
