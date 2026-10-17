/**
 * Google Cloud Run Jobs & Services integration for Portabase Cloud Runner.
 *
 * Implements:
 *   - Google Cloud Run region declarations
 *   - Environment detection (K_SERVICE, CLOUD_RUN_JOB, CLOUD_RUN_EXECUTION, etc.)
 *   - Keyless Google Cloud OIDC identity token fetching via GCP metadata server
 *     (enables keyless access to Google Cloud Storage or federation to AWS S3 via AssumeRoleWithWebIdentity)
 *   - Per-subscriber Google Cloud Run Job specification builder (scale-to-zero compute)
 */

export const GOOGLE_CLOUD_RUN_REGIONS = Object.freeze([
  'us-central1',
  'us-east1',
  'us-west1',
  'europe-west1',
  'asia-east1',
]);

export const GCP_METADATA_IDENTITY_URL =
  'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/identity';

/**
 * Detects whether the process is executing inside a Google Cloud Run environment
 * (either a Cloud Run Service or Cloud Run Job).
 *
 * @param {Record<string, string>} [env=process.env]
 * @returns {{
 *   isCloudRun: boolean,
 *   isJob: boolean,
 *   isService: boolean,
 *   service: string | null,
 *   job: string | null,
 *   execution: string | null,
 *   projectId: string | null,
 *   region: string | null,
 *   metadataServerUrl: string,
 * }}
 */
export function detectGoogleCloudRunEnvironment(env = process.env) {
  const service = env.K_SERVICE || null;
  const job = env.CLOUD_RUN_JOB || null;
  const execution = env.CLOUD_RUN_EXECUTION || null;
  const projectId = env.GOOGLE_CLOUD_PROJECT || env.GCP_PROJECT || null;
  const region = env.PORTABASE_GCP_REGION || env.CLOUD_RUN_REGION || null;
  const isService = Boolean(service);
  const isJob = Boolean(job || execution);
  const isCloudRun = isService || isJob || env.PORTABASE_RUNNER_PLATFORM === 'google-cloud-run';

  return {
    isCloudRun,
    isJob,
    isService,
    service,
    job,
    execution,
    projectId,
    region,
    metadataServerUrl: GCP_METADATA_IDENTITY_URL,
  };
}

/**
 * Fetch a keyless Google Cloud OIDC identity token from the GCP Instance Metadata Server.
 *
 * This token can be used directly to authenticate to Google Cloud Storage or federate
 * into AWS STS via AssumeRoleWithWebIdentity.
 *
 * @param {object} params
 * @param {string} params.audience - The target audience (e.g. AWS role audience or custom URL)
 * @param {typeof fetch} [params.fetchImpl=globalThis.fetch] - Fetch implementation
 * @param {string} [params.metadataUrl] - Metadata token URL override
 * @returns {Promise<string>} OIDC identity token (JWT string)
 */
export async function fetchGcpIdentityToken({
  audience,
  fetchImpl = globalThis.fetch,
  metadataUrl = GCP_METADATA_IDENTITY_URL,
} = {}) {
  if (!audience || typeof audience !== 'string') {
    const err = new Error('audience is required for GCP OIDC identity token');
    err.code = 'missing_audience';
    throw err;
  }

  const url = new URL(metadataUrl);
  url.searchParams.set('audience', audience);
  url.searchParams.set('format', 'full');

  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {
        'Metadata-Flavor': 'Google',
      },
    });
  } catch (err) {
    const error = new Error(`Failed to contact GCP metadata server: ${err.message}`);
    error.code = 'gcp_metadata_unreachable';
    error.status = 502;
    throw error;
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    const error = new Error(`GCP metadata server returned HTTP ${response.status}: ${text}`);
    error.code = 'gcp_metadata_error';
    error.status = response.status;
    throw error;
  }

  const token = (await response.text()).trim();
  if (!token) {
    const error = new Error('GCP metadata server returned empty identity token');
    error.code = 'empty_identity_token';
    throw error;
  }

  return token;
}

/**
 * Builds the Cloud Run Job declarative resource spec and gcloud CLI command
 * for an isolated per-subscriber runner.
 *
 * @param {object} params
 * @param {string} params.subscriberId - Unique subscriber identifier
 * @param {string} params.runnerId - Cloud runner identifier
 * @param {string} [params.projectId] - Google Cloud Project ID
 * @param {string} [params.region='us-central1'] - Cloud Run Region
 * @param {string} [params.image='gcr.io/portabase-public/runner:latest'] - Runner container image
 * @param {string} [params.serviceAccountEmail] - Dedicated runner service account email
 * @returns {object} Cloud Run Job configuration specification
 */
export function buildCloudRunJobSpec({
  subscriberId,
  runnerId,
  projectId = process.env.GOOGLE_CLOUD_PROJECT || 'my-project',
  region = 'us-central1',
  image = 'gcr.io/portabase-public/runner:latest',
  serviceAccountEmail = null,
} = {}) {
  if (!subscriberId) {
    const err = new Error('subscriberId is required');
    err.code = 'missing_subscriber';
    throw err;
  }
  if (!runnerId) {
    const err = new Error('runnerId is required');
    err.code = 'missing_runner';
    throw err;
  }

  const safeRunnerId = runnerId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const safeSubscriberId = subscriberId.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const jobName = `portabase-runner-${safeRunnerId}`;

  const spec = {
    apiVersion: 'run.googleapis.com/v1',
    kind: 'Job',
    metadata: {
      name: jobName,
      namespace: projectId,
      labels: {
        'portabase.dev/subscriber': safeSubscriberId,
        'portabase.dev/runner': safeRunnerId,
      },
      annotations: {
        'run.googleapis.com/launch-stage': 'GA',
      },
    },
    spec: {
      template: {
        metadata: {
          annotations: {
            'run.googleapis.com/vpc-access-egress': 'all-traffic',
          },
        },
        spec: {
          taskCount: 1,
          template: {
            spec: {
              ...(serviceAccountEmail ? { serviceAccountName: serviceAccountEmail } : {}),
              containers: [
                {
                  image,
                  env: [
                    { name: 'PORTABASE_RUNNER_ID', value: runnerId },
                    { name: 'PORTABASE_SUBSCRIBER_ID', value: subscriberId },
                    { name: 'PORTABASE_RUNNER_PLATFORM', value: 'google-cloud-run' },
                    { name: 'PORTABASE_GCP_REGION', value: region },
                    { name: 'PORT', value: '8080' },
                  ],
                  resources: {
                    limits: {
                      cpu: '2',
                      memory: '2Gi',
                    },
                  },
                },
              ],
              timeoutSeconds: 3600,
              maxRetries: 1,
            },
          },
        },
      },
    },
    gcloudCommand: `gcloud run jobs create ${jobName} --image=${image} --region=${region} --project=${projectId} --set-env-vars=PORTABASE_RUNNER_ID=${runnerId},PORTABASE_SUBSCRIBER_ID=${subscriberId},PORTABASE_RUNNER_PLATFORM=google-cloud-run,PORTABASE_GCP_REGION=${region},PORT=8080 --cpu=2 --memory=2Gi --task-timeout=3600 --max-retries=1${serviceAccountEmail ? ` --service-account=${serviceAccountEmail}` : ''}`,
  };

  return spec;
}
