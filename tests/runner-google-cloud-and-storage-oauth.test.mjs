import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';

import {
  GOOGLE_CLOUD_RUN_REGIONS,
  GCP_METADATA_IDENTITY_URL,
  detectGoogleCloudRunEnvironment,
  fetchGcpIdentityToken,
  buildCloudRunJobSpec,
} from '../cloud/runner/google-cloud-run.mjs';

import {
  buildGoogleDriveAuthorizeUrl,
  exchangeGoogleDriveOAuthCode,
  refreshGoogleDriveOAuthToken,
  buildDropboxAuthorizeUrl,
  exchangeDropboxOAuthCode,
  refreshDropboxOAuthToken,
  exchangeAwsS3WebIdentityToken,
  buildAwsS3QuickCreateUrl,
  buildAwsS3OidcCloudFormationTemplate,
} from '../cloud/runner/storage-oauth.mjs';

import {
  discoverSupabaseProjectCredentials,
} from '../cloud/runner/supabase-oauth.mjs';

import {
  validateRuntimeSecrets,
  privateRuntimeSecretStatus,
  runtimeSecretUpdates,
  savePrivateRuntimeSecrets,
  loadPrivateRuntimeSecrets,
} from '../cloud/runner/runtime-secrets.mjs';

import { startPrivateSetupUiServer } from '../utility/ui/private-server.mjs';

/* ─────────────────────────────────────────────────────────────
   1. GOOGLE CLOUD RUN ENVIRONMENT & OIDC IDENTITY TOKENS
───────────────────────────────────────────────────────────── */

test('detectGoogleCloudRunEnvironment detects Cloud Run Jobs and Services', () => {
  // Empty env -> not Cloud Run
  const empty = detectGoogleCloudRunEnvironment({});
  assert.equal(empty.isCloudRun, false);
  assert.equal(empty.isJob, false);
  assert.equal(empty.isService, false);
  assert.equal(empty.service, null);
  assert.equal(empty.job, null);
  assert.equal(empty.metadataServerUrl, GCP_METADATA_IDENTITY_URL);

  // Cloud Run Service (K_SERVICE)
  const serviceEnv = detectGoogleCloudRunEnvironment({
    K_SERVICE: 'portabase-runner-service',
    GOOGLE_CLOUD_PROJECT: 'my-gcp-project',
    PORTABASE_GCP_REGION: 'us-central1',
  });
  assert.equal(serviceEnv.isCloudRun, true);
  assert.equal(serviceEnv.isService, true);
  assert.equal(serviceEnv.isJob, false);
  assert.equal(serviceEnv.service, 'portabase-runner-service');
  assert.equal(serviceEnv.projectId, 'my-gcp-project');
  assert.equal(serviceEnv.region, 'us-central1');

  // Cloud Run Job (CLOUD_RUN_JOB & CLOUD_RUN_EXECUTION)
  const jobEnv = detectGoogleCloudRunEnvironment({
    CLOUD_RUN_JOB: 'portabase-backup-job',
    CLOUD_RUN_EXECUTION: 'portabase-backup-job-123',
    GOOGLE_CLOUD_PROJECT: 'my-gcp-project',
  });
  assert.equal(jobEnv.isCloudRun, true);
  assert.equal(jobEnv.isJob, true);
  assert.equal(jobEnv.isService, false);
  assert.equal(jobEnv.job, 'portabase-backup-job');
  assert.equal(jobEnv.execution, 'portabase-backup-job-123');

  // Explicit runner platform flag
  const platformEnv = detectGoogleCloudRunEnvironment({
    PORTABASE_RUNNER_PLATFORM: 'google-cloud-run',
  });
  assert.equal(platformEnv.isCloudRun, true);

  // Regions list contains standard GCP regions
  assert.ok(GOOGLE_CLOUD_RUN_REGIONS.includes('us-central1'));
  assert.ok(GOOGLE_CLOUD_RUN_REGIONS.includes('us-east1'));
  assert.ok(GOOGLE_CLOUD_RUN_REGIONS.includes('us-west1'));
  assert.ok(GOOGLE_CLOUD_RUN_REGIONS.includes('europe-west1'));
  assert.ok(GOOGLE_CLOUD_RUN_REGIONS.includes('asia-east1'));
});

test('fetchGcpIdentityToken fetches OIDC token from metadata server with Google header', async () => {
  // Throws on missing audience
  await assert.rejects(
    fetchGcpIdentityToken({ audience: '' }),
    { code: 'missing_audience' }
  );

  let capturedUrl = null;
  let capturedHeaders = null;

  const mockFetch = async (url, init) => {
    capturedUrl = url;
    capturedHeaders = init?.headers;
    return {
      ok: true,
      status: 200,
      text: async () => 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjEyMyJ9.eyJuYW1lIjoiZ2NwLWlkZW50aXR5In0.signature',
    };
  };

  const token = await fetchGcpIdentityToken({
    audience: 'https://sts.amazonaws.com',
    fetchImpl: mockFetch,
  });

  assert.match(token, /^eyJ/);
  assert.ok(capturedUrl.includes('audience=https%3A%2F%2Fsts.amazonaws.com'));
  assert.ok(capturedUrl.includes('format=full'));
  assert.equal(capturedHeaders['Metadata-Flavor'], 'Google');

  // Error handling: HTTP 500
  const failingFetch = async () => ({
    ok: false,
    status: 500,
    text: async () => 'Internal Server Error',
  });
  await assert.rejects(
    fetchGcpIdentityToken({ audience: 'test', fetchImpl: failingFetch }),
    { code: 'gcp_metadata_error' }
  );

  // Error handling: network failure
  const networkErrorFetch = async () => {
    throw new Error('connect ECONNREFUSED 169.254.169.254');
  };
  await assert.rejects(
    fetchGcpIdentityToken({ audience: 'test', fetchImpl: networkErrorFetch }),
    { code: 'gcp_metadata_unreachable' }
  );
});

test('buildCloudRunJobSpec generates declarative Cloud Run Job spec and gcloud command', () => {
  assert.throws(
    () => buildCloudRunJobSpec({ subscriberId: '' }),
    { code: 'missing_subscriber' }
  );
  assert.throws(
    () => buildCloudRunJobSpec({ subscriberId: 'sub_1', runnerId: '' }),
    { code: 'missing_runner' }
  );

  const spec = buildCloudRunJobSpec({
    subscriberId: 'supabase:sub_12345',
    runnerId: 'run_abcd-ef01-2345',
    projectId: 'my-gcp-project',
    region: 'us-central1',
    image: 'gcr.io/portabase-public/runner:v1.0.0',
    serviceAccountEmail: 'runner@my-gcp-project.iam.gserviceaccount.com',
  });

  assert.equal(spec.apiVersion, 'run.googleapis.com/v1');
  assert.equal(spec.kind, 'Job');
  assert.equal(spec.metadata.name, 'portabase-runner-run-abcd-ef01-2345');
  assert.equal(spec.metadata.namespace, 'my-gcp-project');
  assert.equal(spec.spec.template.spec.template.spec.serviceAccountName, 'runner@my-gcp-project.iam.gserviceaccount.com');

  const container = spec.spec.template.spec.template.spec.containers[0];
  assert.equal(container.image, 'gcr.io/portabase-public/runner:v1.0.0');

  const envMap = Object.fromEntries(container.env.map(e => [e.name, e.value]));
  assert.equal(envMap.PORTABASE_RUNNER_ID, 'run_abcd-ef01-2345');
  assert.equal(envMap.PORTABASE_SUBSCRIBER_ID, 'supabase:sub_12345');
  assert.equal(envMap.PORTABASE_RUNNER_PLATFORM, 'google-cloud-run');
  assert.equal(envMap.PORTABASE_GCP_REGION, 'us-central1');
  assert.equal(envMap.PORT, '8080');

  assert.ok(spec.gcloudCommand.includes('gcloud run jobs create portabase-runner-run-abcd-ef01-2345'));
  assert.ok(spec.gcloudCommand.includes('--region=us-central1'));
  assert.ok(spec.gcloudCommand.includes('--service-account=runner@my-gcp-project.iam.gserviceaccount.com'));
});

/* ─────────────────────────────────────────────────────────────
   2. GOOGLE DRIVE OAUTH2 (PKCE + REFRESH TOKEN)
───────────────────────────────────────────────────────────── */

test('Google Drive OAuth PKCE builder, exchange, and refresh token', async () => {
  // 1. Authorize URL validation and construction
  assert.throws(
    () => buildGoogleDriveAuthorizeUrl({ clientId: '', redirectUri: 'http://localhost/cb', codeChallenge: 'xyz' }),
    { code: 'invalid_client_id' }
  );

  const authUrl = buildGoogleDriveAuthorizeUrl({
    clientId: 'gdrive-client-id.apps.googleusercontent.com',
    redirectUri: 'http://127.0.0.1:4040/oauth/google-drive/callback',
    codeChallenge: 'challenge-gdrive-pkce',
    state: 'state-gdrive-csrf',
    loginHint: 'customer@gmail.com',
  });

  const parsedAuthUrl = new URL(authUrl);
  assert.equal(parsedAuthUrl.origin, 'https://accounts.google.com');
  assert.equal(parsedAuthUrl.pathname, '/o/oauth2/v2/auth');
  assert.equal(parsedAuthUrl.searchParams.get('client_id'), 'gdrive-client-id.apps.googleusercontent.com');
  assert.equal(parsedAuthUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:4040/oauth/google-drive/callback');
  assert.equal(parsedAuthUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedAuthUrl.searchParams.get('access_type'), 'offline');
  assert.equal(parsedAuthUrl.searchParams.get('prompt'), 'consent');
  assert.equal(parsedAuthUrl.searchParams.get('code_challenge'), 'challenge-gdrive-pkce');
  assert.equal(parsedAuthUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsedAuthUrl.searchParams.get('state'), 'state-gdrive-csrf');
  assert.equal(parsedAuthUrl.searchParams.get('login_hint'), 'customer@gmail.com');
  assert.equal(parsedAuthUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');

  // 2. Exchange authorization code
  let capturedBody = null;
  const mockExchangeFetch = async (url, init) => {
    capturedBody = new URLSearchParams(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'ya29.a0AfH6SM_test_token',
        refresh_token: '1//0gdrive_refresh_token_xyz',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'https://www.googleapis.com/auth/drive.file',
      }),
    };
  };

  const tokens = await exchangeGoogleDriveOAuthCode({
    code: 'google-code-12345',
    codeVerifier: 'verifier-gdrive-pkce',
    redirectUri: 'http://127.0.0.1:4040/oauth/google-drive/callback',
    clientId: 'gdrive-client-id.apps.googleusercontent.com',
    fetchImpl: mockExchangeFetch,
  });

  assert.equal(tokens.accessToken, 'ya29.a0AfH6SM_test_token');
  assert.equal(tokens.refreshToken, '1//0gdrive_refresh_token_xyz');
  assert.equal(tokens.expiresIn, 3600);
  assert.ok(tokens.expiresAt > Date.now());
  assert.equal(capturedBody.get('grant_type'), 'authorization_code');
  assert.equal(capturedBody.get('code'), 'google-code-12345');
  assert.equal(capturedBody.get('code_verifier'), 'verifier-gdrive-pkce');

  // 3. Refresh access token
  const mockRefreshFetch = async (url, init) => {
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('refresh_token'), '1//0gdrive_refresh_token_xyz');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'ya29.refreshed_access_token',
        expires_in: 3600,
        token_type: 'Bearer',
      }),
    };
  };

  const refreshed = await refreshGoogleDriveOAuthToken({
    refreshToken: '1//0gdrive_refresh_token_xyz',
    clientId: 'gdrive-client-id.apps.googleusercontent.com',
    fetchImpl: mockRefreshFetch,
  });

  assert.equal(refreshed.accessToken, 'ya29.refreshed_access_token');
  assert.equal(refreshed.refreshToken, '1//0gdrive_refresh_token_xyz'); // Preserved when not rotated
});

/* ─────────────────────────────────────────────────────────────
   3. DROPBOX OAUTH2 (PKCE + REFRESH TOKEN)
───────────────────────────────────────────────────────────── */

test('Dropbox OAuth PKCE builder, exchange, and refresh token', async () => {
  // 1. Authorize URL
  assert.throws(
    () => buildDropboxAuthorizeUrl({ clientId: '', redirectUri: 'http://localhost/cb', codeChallenge: 'xyz' }),
    { code: 'invalid_client_id' }
  );

  const authUrl = buildDropboxAuthorizeUrl({
    clientId: 'dropbox-app-key-123',
    redirectUri: 'http://127.0.0.1:4040/oauth/dropbox/callback',
    codeChallenge: 'challenge-dropbox-pkce',
    state: 'state-dropbox-csrf',
  });

  const parsedAuthUrl = new URL(authUrl);
  assert.equal(parsedAuthUrl.origin, 'https://www.dropbox.com');
  assert.equal(parsedAuthUrl.pathname, '/oauth2/authorize');
  assert.equal(parsedAuthUrl.searchParams.get('client_id'), 'dropbox-app-key-123');
  assert.equal(parsedAuthUrl.searchParams.get('redirect_uri'), 'http://127.0.0.1:4040/oauth/dropbox/callback');
  assert.equal(parsedAuthUrl.searchParams.get('response_type'), 'code');
  assert.equal(parsedAuthUrl.searchParams.get('token_access_type'), 'offline');
  assert.equal(parsedAuthUrl.searchParams.get('code_challenge'), 'challenge-dropbox-pkce');
  assert.equal(parsedAuthUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(parsedAuthUrl.searchParams.get('state'), 'state-dropbox-csrf');

  // 2. Exchange authorization code
  let capturedBody = null;
  const mockExchangeFetch = async (url, init) => {
    capturedBody = new URLSearchParams(init.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'sl.u.dropbox_access_token_abc',
        refresh_token: 'dropbox_refresh_token_xyz',
        expires_in: 14400,
        token_type: 'bearer',
        account_id: 'dbid:AAAH_example_account',
        uid: '12345678',
      }),
    };
  };

  const tokens = await exchangeDropboxOAuthCode({
    code: 'dropbox-code-123',
    codeVerifier: 'verifier-dropbox-pkce',
    redirectUri: 'http://127.0.0.1:4040/oauth/dropbox/callback',
    clientId: 'dropbox-app-key-123',
    fetchImpl: mockExchangeFetch,
  });

  assert.equal(tokens.accessToken, 'sl.u.dropbox_access_token_abc');
  assert.equal(tokens.refreshToken, 'dropbox_refresh_token_xyz');
  assert.equal(tokens.accountId, 'dbid:AAAH_example_account');
  assert.equal(tokens.expiresIn, 14400);
  assert.equal(capturedBody.get('grant_type'), 'authorization_code');
  assert.equal(capturedBody.get('code_verifier'), 'verifier-dropbox-pkce');

  // 3. Refresh token
  const mockRefreshFetch = async (url, init) => {
    const params = new URLSearchParams(init.body);
    assert.equal(params.get('grant_type'), 'refresh_token');
    assert.equal(params.get('refresh_token'), 'dropbox_refresh_token_xyz');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'sl.u.dropbox_fresh_access_token',
        expires_in: 14400,
        token_type: 'bearer',
      }),
    };
  };

  const refreshed = await refreshDropboxOAuthToken({
    refreshToken: 'dropbox_refresh_token_xyz',
    clientId: 'dropbox-app-key-123',
    fetchImpl: mockRefreshFetch,
  });

  assert.equal(refreshed.accessToken, 'sl.u.dropbox_fresh_access_token');
  assert.equal(refreshed.refreshToken, 'dropbox_refresh_token_xyz');
});

/* ─────────────────────────────────────────────────────────────
   4. AWS S3 OIDC WEB IDENTITY FEDERATION & CLOUDFORMATION
───────────────────────────────────────────────────────────── */

test('AWS S3 AssumeRoleWithWebIdentity OIDC token exchange and CloudFormation URL', async () => {
  // 1. Validations
  await assert.rejects(
    exchangeAwsS3WebIdentityToken({ roleArn: 'invalid-arn', webIdentityToken: 'jwt' }),
    { code: 'invalid_role_arn' }
  );
  await assert.rejects(
    exchangeAwsS3WebIdentityToken({ roleArn: 'arn:aws:iam::123456789012:role/PortabaseRole', webIdentityToken: '' }),
    { code: 'missing_web_identity_token' }
  );

  // 2. STS XML response parsing
  const mockXmlResponse = `
    <AssumeRoleWithWebIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
      <AssumeRoleWithWebIdentityResult>
        <Credentials>
          <AccessKeyId>ASIAEXAMPLEKEY12345</AccessKeyId>
          <SecretAccessKey>wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY</SecretAccessKey>
          <SessionToken>AQoDYXdzEJr111111111111111111111111111111111111111111</SessionToken>
          <Expiration>2026-10-17T18:00:00Z</Expiration>
        </Credentials>
      </AssumeRoleWithWebIdentityResult>
    </AssumeRoleWithWebIdentityResponse>
  `;

  let capturedParams = null;
  const mockStsFetch = async (url, init) => {
    capturedParams = new URLSearchParams(init.body);
    return {
      ok: true,
      status: 200,
      text: async () => mockXmlResponse,
    };
  };

  const creds = await exchangeAwsS3WebIdentityToken({
    roleArn: 'arn:aws:iam::123456789012:role/PortabaseS3RunnerRole',
    webIdentityToken: 'mock.oidc.token',
    fetchImpl: mockStsFetch,
  });

  assert.equal(creds.accessKeyId, 'ASIAEXAMPLEKEY12345');
  assert.equal(creds.secretAccessKey, 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  assert.ok(creds.sessionToken.startsWith('AQoD'));
  assert.equal(creds.expiration, '2026-10-17T18:00:00Z');
  assert.equal(creds.bucketRegion, 'us-east-1');

  assert.equal(capturedParams.get('Action'), 'AssumeRoleWithWebIdentity');
  assert.equal(capturedParams.get('RoleArn'), 'arn:aws:iam::123456789012:role/PortabaseS3RunnerRole');
  assert.equal(capturedParams.get('WebIdentityToken'), 'mock.oidc.token');

  // 3. Error XML parsing
  const mockErrorXml = `
    <ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
      <Error>
        <Type>Sender</Type>
        <Code>InvalidIdentityToken</Code>
        <Message>The OpenID Connect token has expired or is invalid</Message>
      </Error>
    </ErrorResponse>
  `;
  const mockErrorFetch = async () => ({
    ok: false,
    status: 400,
    text: async () => mockErrorXml,
  });
  await assert.rejects(
    exchangeAwsS3WebIdentityToken({
      roleArn: 'arn:aws:iam::123456789012:role/PortabaseS3RunnerRole',
      webIdentityToken: 'expired.token',
      fetchImpl: mockErrorFetch,
    }),
    { code: 'InvalidIdentityToken' }
  );

  // 4. CloudFormation Quick-Create review URL builder
  const qCreateUrl = buildAwsS3QuickCreateUrl({
    region: 'us-east-1',
    bucketName: 'customer-supabase-backups',
    oidcClientId: 'https://accounts.google.com',
    roleName: 'PortabaseS3RunnerRole',
  });

  assert.ok(qCreateUrl.startsWith('https://us-east-1.console.aws.amazon.com/cloudformation/home'));
  assert.ok(qCreateUrl.includes('customer-supabase-backups'));
  assert.ok(qCreateUrl.includes('PortabaseS3RunnerRole'));
  assert.ok(qCreateUrl.includes('stacks/create/review'));

  // 5. CloudFormation Template Generator
  const template = buildAwsS3OidcCloudFormationTemplate({
    bucketName: 'customer-supabase-backups',
    oidcClientId: 'https://accounts.google.com',
    roleName: 'PortabaseS3RunnerRole',
  });
  assert.ok(template.includes('AWSTemplateFormatVersion'));
  assert.ok(template.includes('AssumeRoleWithWebIdentity'));
  assert.ok(template.includes('accounts.google.com'));
  assert.ok(template.includes('s3:PutObject'));
});

/* ─────────────────────────────────────────────────────────────
   5. EXTEND SUPABASE OAUTH AUTO-DISCOVERY
───────────────────────────────────────────────────────────── */

test('discoverSupabaseProjectCredentials resolves URL and service_role key automatically from token', async () => {
  // Throws on missing token
  await assert.rejects(
    discoverSupabaseProjectCredentials({ accessToken: '' }),
    { code: 'missing_access_token' }
  );

  // Scenario 1: projectRef is specified directly
  const mockFetchExplicitRef = async (url) => {
    if (url.includes('/api-keys')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { name: 'anon', api_key: 'sb_publishable_anon_12345' },
          { name: 'service_role', api_key: 'sb_secret_service_role_67890' },
        ],
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const creds1 = await discoverSupabaseProjectCredentials({
    accessToken: 'sbp_mock_management_token',
    projectRef: 'abcdefghijklmnopqrst',
    fetchImpl: mockFetchExplicitRef,
  });

  assert.equal(creds1.projectRef, 'abcdefghijklmnopqrst');
  assert.equal(creds1.supabaseUrl, 'https://abcdefghijklmnopqrst.supabase.co');
  assert.equal(creds1.serviceRoleKey, 'sb_secret_service_role_67890');
  assert.equal(creds1.anonKey, 'sb_publishable_anon_12345');

  // Scenario 2: projectRef not specified -> queries /v1/projects first
  const mockFetchAutoRef = async (url) => {
    if (url.endsWith('/v1/projects')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { id: 'zyxwvutsrqponmlkjihg', name: 'Production Database', region: 'us-east-1' },
        ],
      };
    }
    if (url.includes('/zyxwvutsrqponmlkjihg/api-keys')) {
      return {
        ok: true,
        status: 200,
        json: async () => [
          { name: 'anon', api_key: 'sb_publishable_anon_999' },
          { name: 'service_role', api_key: 'sb_secret_service_role_999' },
        ],
      };
    }
    throw new Error(`Unexpected URL: ${url}`);
  };

  const creds2 = await discoverSupabaseProjectCredentials({
    accessToken: 'sbp_mock_management_token',
    fetchImpl: mockFetchAutoRef,
  });

  assert.equal(creds2.projectRef, 'zyxwvutsrqponmlkjihg');
  assert.equal(creds2.supabaseUrl, 'https://zyxwvutsrqponmlkjihg.supabase.co');
  assert.equal(creds2.serviceRoleKey, 'sb_secret_service_role_999');
});

/* ─────────────────────────────────────────────────────────────
   6. RUNTIME SECRETS & UI SERVER STORAGE OAUTH ENDPOINTS
───────────────────────────────────────────────────────────── */

test('runtime-secrets validates and persists storage OAuth and keyless configuration', async () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const directory = await mkdtemp(join(tmpdir(), 'portabase-storage-secrets-'));

  const envWithStorage = {
    SUPABASE_URL: `https://${projectRef}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres:secret@db.${projectRef}.supabase.co:5432/postgres`,
    SUPABASE_SERVICE_ROLE_KEY: 'service_role_key_value_123',
    SUPABASE_REFRESH_TOKEN: 'sbr_test_refresh_token_12345',
    GOOGLE_DRIVE_REFRESH_TOKEN: '1//0gdrive_refresh_token_abc',
    GOOGLE_DRIVE_CLIENT_ID: 'gdrive_client_id_123',
    DROPBOX_REFRESH_TOKEN: 'dropbox_refresh_token_abc',
    GCS_BUCKET_URI: 'gs://my-supabase-backup-vault',
    AWS_S3_ROLE_ARN: 'arn:aws:iam::123456789012:role/PortabaseS3RunnerRole',
    AWS_S3_BUCKET: 'my-supabase-backups',
  };

  const validated = validateRuntimeSecrets(envWithStorage, projectRef);
  assert.equal(validated.GOOGLE_DRIVE_REFRESH_TOKEN, '1//0gdrive_refresh_token_abc');
  assert.equal(validated.DROPBOX_REFRESH_TOKEN, 'dropbox_refresh_token_abc');
  assert.equal(validated.GCS_BUCKET_URI, 'gs://my-supabase-backup-vault');
  assert.equal(validated.AWS_S3_ROLE_ARN, 'arn:aws:iam::123456789012:role/PortabaseS3RunnerRole');
  assert.equal(validated.AWS_S3_BUCKET, 'my-supabase-backups');

  const status = privateRuntimeSecretStatus(envWithStorage);
  assert.equal(status.hasGoogleDrive, true);
  assert.equal(status.hasDropbox, true);
  assert.equal(status.hasGcs, true);
  assert.equal(status.hasAwsOidc, true);
  assert.equal(status.storageConfigured, true);

  // runtimeSecretUpdates accepts storage fields
  const updates = runtimeSecretUpdates({
    googleDriveRefreshToken: '1//0gdrive_new_token_456',
    dropboxRefreshToken: 'dropbox_new_token_456',
    gcsBucketUri: 'gs://new-backup-bucket',
    awsS3RoleArn: 'arn:aws:iam::123456789012:role/UpdatedRole',
    awsS3Bucket: 'updated-s3-bucket',
  }, projectRef);

  assert.equal(updates.GOOGLE_DRIVE_REFRESH_TOKEN, '1//0gdrive_new_token_456');
  assert.equal(updates.DROPBOX_REFRESH_TOKEN, 'dropbox_new_token_456');
  assert.equal(updates.GCS_BUCKET_URI, 'gs://new-backup-bucket');
  assert.equal(updates.AWS_S3_ROLE_ARN, 'arn:aws:iam::123456789012:role/UpdatedRole');
  assert.equal(updates.AWS_S3_BUCKET, 'updated-s3-bucket');

  // Persistence to disk
  await savePrivateRuntimeSecrets({ directory, projectRef }, {
    ...envWithStorage,
    ...updates,
  });

  const loaded = await loadPrivateRuntimeSecrets({ directory, projectRef });
  assert.equal(loaded.env.GOOGLE_DRIVE_REFRESH_TOKEN, '1//0gdrive_new_token_456');
  assert.equal(loaded.env.DROPBOX_REFRESH_TOKEN, 'dropbox_new_token_456');
  assert.equal(loaded.env.GCS_BUCKET_URI, 'gs://new-backup-bucket');
  assert.equal(loaded.status.hasGoogleDrive, true);
  assert.equal(loaded.status.hasGcs, true);
});

function httpCall(server, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const bytes = typeof body === 'string' ? body : body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        host: '127.0.0.1',
        port: server.address.port,
        path,
        method,
        headers: {
          ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bytes) } : {}),
          'X-Portabase-Session': server.token,
          ...headers,
        },
      },
      response => {
        let data = '';
        response.on('data', chunk => { data += chunk; });
        response.on('end', () => {
          let json;
          try { json = JSON.parse(data); } catch { /* static */ }
          resolve({ status: response.statusCode, headers: response.headers, json, data });
        });
      }
    );
    req.on('error', reject);
    req.end(bytes);
  });
}

test('private setup UI server exposes Google Drive and Dropbox OAuth endpoints', async () => {
  const projectRef = 'abcdefghijklmnopqrst';
  const directory = await mkdtemp(join(tmpdir(), 'portabase-ui-storage-oauth-test-'));
  const config = { projectRef, provider: { type: 's3', bucket: 'test' }, backupDirectory: 'capsules', statusDirectory: 'status' };
  await writeFile(join(directory, 'engine.json'), JSON.stringify(config));

  const server = await startPrivateSetupUiServer({
    privateSetup: {
      directory,
      runnerId: '11111111-1111-4111-8111-111111111111',
      projectRef,
      engineConfigPath: 'engine.json',
    },
    collect: async () => ({
      project: { ref: projectRef },
      database: { ok: true, data: { tables: [] } },
      storage: { ok: true, data: { buckets: [] } },
    }),
  });

  try {
    const setup = (await httpCall(server, '/api/setup')).json;
    const csrfHeaders = {
      Origin: `http://127.0.0.1:${server.address.port}`,
      'X-Portabase-CSRF': setup.csrf,
    };

    // 1. GET /oauth/google-drive/start redirects to Google Accounts
    const getGdriveStart = await httpCall(server, '/oauth/google-drive/start');
    assert.equal(getGdriveStart.status, 302);
    assert.ok(getGdriveStart.headers.location.startsWith('https://accounts.google.com/o/oauth2/v2/auth'));
    assert.ok(getGdriveStart.headers.location.includes('scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive.file'));

    // 2. GET /oauth/dropbox/start redirects to Dropbox
    const getDropboxStart = await httpCall(server, '/oauth/dropbox/start');
    assert.equal(getDropboxStart.status, 302);
    assert.ok(getDropboxStart.headers.location.startsWith('https://www.dropbox.com/oauth2/authorize'));

    // 3. POST /api/oauth/storage/start for Google Drive
    const postGdriveStart = await httpCall(server, '/api/oauth/storage/start', {
      method: 'POST',
      body: { provider: 'google-drive' },
      headers: csrfHeaders,
    });
    assert.equal(postGdriveStart.status, 200);
    assert.equal(postGdriveStart.json.ok, true);
    assert.equal(postGdriveStart.json.provider, 'google-drive');
    assert.ok(postGdriveStart.json.authorizeUrl);
    assert.ok(postGdriveStart.json.codeVerifier);

    // 4. POST /api/oauth/storage/start for Dropbox
    const postDropboxStart = await httpCall(server, '/api/oauth/storage/start', {
      method: 'POST',
      body: { provider: 'dropbox' },
      headers: csrfHeaders,
    });
    assert.equal(postDropboxStart.status, 200);
    assert.equal(postDropboxStart.json.ok, true);
    assert.equal(postDropboxStart.json.provider, 'dropbox');
    assert.ok(postDropboxStart.json.authorizeUrl);

    // 5. POST /api/connections updates storage fields
    const connRes = await httpCall(server, '/api/connections', {
      method: 'POST',
      body: {
        googleDriveRefreshToken: '1//0gdrive_from_api_connections',
        dropboxRefreshToken: 'dropbox_from_api_connections',
        gcsBucketUri: 'gs://connections-bucket',
      },
      headers: csrfHeaders,
    });
    assert.equal(connRes.status, 201);
    assert.equal(connRes.json.saved, true);
    assert.equal(connRes.json.connections.hasGoogleDrive, true);
    assert.equal(connRes.json.connections.hasDropbox, true);
    assert.equal(connRes.json.connections.hasGcs, true);

    const loaded = await loadPrivateRuntimeSecrets({ directory, projectRef });
    assert.equal(loaded.env.GOOGLE_DRIVE_REFRESH_TOKEN, '1//0gdrive_from_api_connections');
    assert.equal(loaded.env.DROPBOX_REFRESH_TOKEN, 'dropbox_from_api_connections');
    assert.equal(loaded.env.GCS_BUCKET_URI, 'gs://connections-bucket');
  } finally {
    await server.close();
  }
});
