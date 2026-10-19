/**
 * Cloud Storage OAuth & OIDC Web Identity Federation for Portabase Runner.
 *
 * Implements:
 *   - Google Drive OAuth2 (PKCE + Refresh Token)
 *   - Dropbox OAuth2 (PKCE + Refresh Token)
 *   - AWS S3 OIDC Web Identity Federation (AssumeRoleWithWebIdentity via Google Cloud OIDC / Web Identity)
 *   - 1-Click AWS CloudFormation Quick-Create URL generator for zero-IAM-key S3 backup custody
 */

export const GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_DRIVE_OAUTH_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const DEFAULT_GOOGLE_DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const DROPBOX_OAUTH_AUTHORIZE_URL = 'https://www.dropbox.com/oauth2/authorize';
export const DROPBOX_OAUTH_TOKEN_URL = 'https://api.dropboxapi.com/oauth2/token';

export const AWS_STS_URL = 'https://sts.amazonaws.com/';

const fail = (code, message, status = 400) => {
  throw Object.assign(new Error(message || code), { code, status });
};

/* ─────────────────────────────────────────────────────────────
   GOOGLE DRIVE OAUTH (PKCE + REFRESH TOKEN)
───────────────────────────────────────────────────────────── */

/**
 * Builds the Google Drive OAuth authorization URL using PKCE.
 *
 * @param {object} params
 * @param {string} params.clientId - Google OAuth 2.0 Client ID
 * @param {string} params.redirectUri - OAuth redirect callback URI
 * @param {string} params.codeChallenge - S256 code challenge
 * @param {string} [params.state] - State parameter for CSRF mitigation
 * @param {string} [params.scope] - Scopes (defaults to drive.file)
 * @param {string} [params.loginHint] - Optional user email hint
 * @param {string} [params.authorizeUrl] - Custom authorize URL override
 * @returns {string} Complete authorize URL
 */
export function buildGoogleDriveAuthorizeUrl({
  clientId,
  redirectUri,
  codeChallenge,
  state = null,
  scope = DEFAULT_GOOGLE_DRIVE_SCOPE,
  loginHint = null,
  authorizeUrl = GOOGLE_DRIVE_OAUTH_AUTHORIZE_URL,
}) {
  if (!clientId || typeof clientId !== 'string') fail('invalid_client_id', 'clientId is required');
  if (!redirectUri || typeof redirectUri !== 'string') fail('invalid_redirect_uri', 'redirectUri is required');
  if (!codeChallenge || typeof codeChallenge !== 'string') fail('invalid_code_challenge', 'codeChallenge is required');

  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (scope) url.searchParams.set('scope', scope);
  if (state) url.searchParams.set('state', state);
  if (loginHint) url.searchParams.set('login_hint', loginHint);

  return url.toString();
}

/**
 * Exchanges Google Drive OAuth authorization code for access & refresh tokens.
 *
 * @param {object} params
 * @param {string} params.code - Authorization code
 * @param {string} params.codeVerifier - PKCE code verifier
 * @param {string} params.redirectUri - Redirect URI used in the authorize request
 * @param {string} [params.clientId] - OAuth Client ID
 * @param {string} [params.clientSecret] - OAuth Client Secret (optional for public PKCE clients)
 * @param {string} [params.tokenUrl] - Token endpoint URL override
 * @param {typeof fetch} [params.fetchImpl] - Fetch implementation
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, scope: string, expiresAt: number|null }>}
 */
export async function exchangeGoogleDriveOAuthCode({
  code,
  codeVerifier,
  redirectUri,
  clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  tokenUrl = GOOGLE_DRIVE_OAUTH_TOKEN_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!code || typeof code !== 'string') fail('missing_code', 'OAuth code is required');
  if (!codeVerifier || typeof codeVerifier !== 'string') fail('missing_code_verifier', 'PKCE codeVerifier is required');
  if (!redirectUri || typeof redirectUri !== 'string') fail('missing_redirect_uri', 'redirectUri is required');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  if (clientId) params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });
  } catch (err) {
    fail('oauth_network_error', `Could not reach Google OAuth token endpoint: ${err.message}`, 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('invalid_token_response', 'Google token endpoint returned non-JSON response', response.status);
  }

  if (!response.ok) {
    const code = data?.error || 'oauth_exchange_failed';
    const message = data?.error_description || data?.message || `Google Drive OAuth exchange failed (${response.status})`;
    fail(code, message, response.status);
  }

  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  const tokenType = data.token_type || 'Bearer';
  const scope = data.scope || DEFAULT_GOOGLE_DRIVE_SCOPE;
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) fail('invalid_token_response', 'Google token response missing access_token');

  return {
    accessToken,
    refreshToken: refreshToken || null,
    expiresIn,
    tokenType,
    scope,
    expiresAt,
  };
}

/**
 * Refreshes an expired Google Drive access token using the stored refresh token.
 *
 * @param {object} params
 * @param {string} params.refreshToken - Google Drive refresh token
 * @param {string} [params.clientId] - OAuth Client ID
 * @param {string} [params.clientSecret] - OAuth Client Secret
 * @param {string} [params.tokenUrl] - Token endpoint URL override
 * @param {typeof fetch} [params.fetchImpl] - Fetch implementation
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, expiresAt: number|null }>}
 */
export async function refreshGoogleDriveOAuthToken({
  refreshToken,
  clientId = process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_DRIVE_CLIENT_ID,
  clientSecret = process.env.GOOGLE_CLIENT_SECRET,
  tokenUrl = GOOGLE_DRIVE_OAUTH_TOKEN_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    fail('missing_refresh_token', 'refreshToken is required');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (clientId) params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: params.toString(),
    });
  } catch (err) {
    fail('oauth_network_error', `Could not reach Google OAuth token endpoint: ${err.message}`, 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('invalid_token_response', 'Google token endpoint returned non-JSON response', response.status);
  }

  if (!response.ok) {
    const code = data?.error || 'refresh_token_failed';
    const message = data?.error_description || data?.message || `Google Drive token refresh failed (${response.status})`;
    fail(code, message, response.status);
  }

  const accessToken = data.access_token;
  const newRefreshToken = data.refresh_token || refreshToken;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  const tokenType = data.token_type || 'Bearer';
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) fail('invalid_token_response', 'Google token refresh missing access_token');

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
    tokenType,
    expiresAt,
  };
}

/* ─────────────────────────────────────────────────────────────
   DROPBOX OAUTH (PKCE + REFRESH TOKEN)
───────────────────────────────────────────────────────────── */

/**
 * Builds the Dropbox OAuth authorization URL using PKCE.
 *
 * @param {object} params
 * @param {string} params.clientId - Dropbox App Key / Client ID
 * @param {string} params.redirectUri - OAuth redirect callback URI
 * @param {string} params.codeChallenge - S256 code challenge
 * @param {string} [params.state] - State parameter for CSRF mitigation
 * @param {string} [params.authorizeUrl] - Custom authorize URL override
 * @returns {string} Complete authorize URL
 */
export function buildDropboxAuthorizeUrl({
  clientId,
  redirectUri,
  codeChallenge,
  state = null,
  authorizeUrl = DROPBOX_OAUTH_AUTHORIZE_URL,
}) {
  if (!clientId || typeof clientId !== 'string') fail('invalid_client_id', 'clientId is required');
  if (!redirectUri || typeof redirectUri !== 'string') fail('invalid_redirect_uri', 'redirectUri is required');
  if (!codeChallenge || typeof codeChallenge !== 'string') fail('invalid_code_challenge', 'codeChallenge is required');

  const url = new URL(authorizeUrl);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('token_access_type', 'offline');
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  if (state) url.searchParams.set('state', state);

  return url.toString();
}

/**
 * Exchanges Dropbox OAuth authorization code for access & refresh tokens.
 *
 * @param {object} params
 * @param {string} params.code - Authorization code
 * @param {string} params.codeVerifier - PKCE code verifier
 * @param {string} params.redirectUri - Redirect URI used in the authorize request
 * @param {string} [params.clientId] - Dropbox App Key / Client ID
 * @param {string} [params.clientSecret] - Dropbox App Secret
 * @param {string} [params.tokenUrl] - Token endpoint URL override
 * @param {typeof fetch} [params.fetchImpl] - Fetch implementation
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, accountId: string|null, uid: string|null, expiresAt: number|null }>}
 */
export async function exchangeDropboxOAuthCode({
  code,
  codeVerifier,
  redirectUri,
  clientId = process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID,
  clientSecret = process.env.DROPBOX_APP_SECRET || process.env.DROPBOX_CLIENT_SECRET,
  tokenUrl = DROPBOX_OAUTH_TOKEN_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!code || typeof code !== 'string') fail('missing_code', 'OAuth code is required');
  if (!codeVerifier || typeof codeVerifier !== 'string') fail('missing_code_verifier', 'PKCE codeVerifier is required');
  if (!redirectUri || typeof redirectUri !== 'string') fail('missing_redirect_uri', 'redirectUri is required');

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
  });
  if (clientId) params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  } catch (err) {
    fail('oauth_network_error', `Could not reach Dropbox OAuth token endpoint: ${err.message}`, 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('invalid_token_response', 'Dropbox token endpoint returned non-JSON response', response.status);
  }

  if (!response.ok) {
    const code = data?.error || 'oauth_exchange_failed';
    const message = data?.error_description || data?.message || `Dropbox OAuth exchange failed (${response.status})`;
    fail(code, message, response.status);
  }

  const accessToken = data.access_token;
  const refreshToken = data.refresh_token;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  const tokenType = data.token_type || 'Bearer';
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) fail('invalid_token_response', 'Dropbox token response missing access_token');

  return {
    accessToken,
    refreshToken: refreshToken || null,
    expiresIn,
    tokenType,
    accountId: data.account_id || null,
    uid: data.uid || null,
    expiresAt,
  };
}

/**
 * Refreshes an expired Dropbox access token using the stored refresh token.
 *
 * @param {object} params
 * @param {string} params.refreshToken - Dropbox refresh token
 * @param {string} [params.clientId] - Dropbox App Key / Client ID
 * @param {string} [params.clientSecret] - Dropbox App Secret
 * @param {string} [params.tokenUrl] - Token endpoint URL override
 * @param {typeof fetch} [params.fetchImpl] - Fetch implementation
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresIn: number, tokenType: string, expiresAt: number|null }>}
 */
export async function refreshDropboxOAuthToken({
  refreshToken,
  clientId = process.env.DROPBOX_APP_KEY || process.env.DROPBOX_CLIENT_ID,
  clientSecret = process.env.DROPBOX_APP_SECRET || process.env.DROPBOX_CLIENT_SECRET,
  tokenUrl = DROPBOX_OAUTH_TOKEN_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    fail('missing_refresh_token', 'refreshToken is required');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  if (clientId) params.set('client_id', clientId);
  if (clientSecret) params.set('client_secret', clientSecret);

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  let response;
  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers,
      body: params.toString(),
    });
  } catch (err) {
    fail('oauth_network_error', `Could not reach Dropbox OAuth token endpoint: ${err.message}`, 502);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    fail('invalid_token_response', 'Dropbox token endpoint returned non-JSON response', response.status);
  }

  if (!response.ok) {
    const code = data?.error || 'refresh_token_failed';
    const message = data?.error_description || data?.message || `Dropbox token refresh failed (${response.status})`;
    fail(code, message, response.status);
  }

  const accessToken = data.access_token;
  const newRefreshToken = data.refresh_token || refreshToken;
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : Number(data.expires_in) || 0;
  const tokenType = data.token_type || 'Bearer';
  const expiresAt = expiresIn > 0 ? Date.now() + expiresIn * 1000 : null;

  if (!accessToken) fail('invalid_token_response', 'Dropbox token refresh missing access_token');

  return {
    accessToken,
    refreshToken: newRefreshToken,
    expiresIn,
    tokenType,
    expiresAt,
  };
}

/* ─────────────────────────────────────────────────────────────
   AWS S3 OIDC WEB IDENTITY FEDERATION ("S3 OAUTH")
───────────────────────────────────────────────────────────── */

/**
 * Exchanges a Web Identity OIDC token (such as a Google Cloud Run identity token)
 * for temporary AWS STS credentials via AssumeRoleWithWebIdentity.
 *
 * This provides zero-IAM-key S3 bucket custody: the runner authenticates to AWS S3
 * entirely using cryptographically signed OIDC claims from Google Cloud or an OAuth identity provider.
 *
 * @param {object} params
 * @param {string} params.roleArn - The AWS IAM Role ARN to assume (e.g. arn:aws:iam::123456789012:role/PortabaseRunner)
 * @param {string} params.webIdentityToken - OIDC JWT token
 * @param {string} [params.roleSessionName='portabase-runner-session'] - Session identifier
 * @param {number} [params.durationSeconds=3600] - Session validity duration in seconds (900-43200)
 * @param {string} [params.stsUrl=AWS_STS_URL] - AWS STS endpoint URL
 * @param {typeof fetch} [params.fetchImpl=globalThis.fetch] - Fetch implementation
 * @returns {Promise<{ accessKeyId: string, secretAccessKey: string, sessionToken: string, expiration: string, bucketRegion: string }>}
 */
export async function exchangeAwsS3WebIdentityToken({
  roleArn,
  webIdentityToken,
  roleSessionName = 'portabase-runner-session',
  durationSeconds = 3600,
  stsUrl = AWS_STS_URL,
  fetchImpl = globalThis.fetch,
}) {
  if (!roleArn || !/^arn:aws[a-z0-9-]*:iam::[0-9]{12}:role\/[a-zA-Z0-9+=,.@_-]+$/.test(roleArn)) {
    fail('invalid_role_arn', 'Valid AWS IAM Role ARN is required');
  }
  if (!webIdentityToken || typeof webIdentityToken !== 'string') {
    fail('missing_web_identity_token', 'Web identity token is required');
  }

  const params = new URLSearchParams({
    Action: 'AssumeRoleWithWebIdentity',
    Version: '2011-06-15',
    RoleArn: roleArn,
    RoleSessionName: roleSessionName,
    WebIdentityToken: webIdentityToken,
    DurationSeconds: String(durationSeconds),
  });

  let response;
  try {
    response = await fetchImpl(stsUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json, text/xml',
      },
      body: params.toString(),
    });
  } catch (err) {
    fail('sts_network_error', `Could not reach AWS STS endpoint: ${err.message}`, 502);
  }

  const text = await response.text();

  if (!response.ok) {
    // Parse error from XML or JSON
    const codeMatch = text.match(/<Code>([^<]+)<\/Code>/i);
    const messageMatch = text.match(/<Message>([^<]+)<\/Message>/i);
    const errCode = codeMatch ? codeMatch[1] : 'sts_assume_role_failed';
    const errMsg = messageMatch ? messageMatch[1] : `AWS STS returned HTTP ${response.status}: ${text}`;
    fail(errCode, errMsg, response.status);
  }

  // Attempt JSON parse first
  try {
    const json = JSON.parse(text);
    const creds =
      json.AssumeRoleWithWebIdentityResponse?.AssumeRoleWithWebIdentityResult?.Credentials ||
      json.Credentials;
    if (creds?.AccessKeyId && creds?.SecretAccessKey) {
      return {
        accessKeyId: creds.AccessKeyId,
        secretAccessKey: creds.SecretAccessKey,
        sessionToken: creds.SessionToken,
        expiration: creds.Expiration,
        bucketRegion: 'us-east-1',
      };
    }
  } catch {
    // Fall back to XML parsing
  }

  // Parse XML elements
  const accessKeyMatch = text.match(/<AccessKeyId>([^<]+)<\/AccessKeyId>/i);
  const secretKeyMatch = text.match(/<SecretAccessKey>([^<]+)<\/SecretAccessKey>/i);
  const sessionTokenMatch = text.match(/<SessionToken>([^<]+)<\/SessionToken>/i);
  const expirationMatch = text.match(/<Expiration>([^<]+)<\/Expiration>/i);

  if (!accessKeyMatch || !secretKeyMatch) {
    fail('invalid_sts_response', 'AWS STS response missing required credentials');
  }

  return {
    accessKeyId: accessKeyMatch[1],
    secretAccessKey: secretKeyMatch[1],
    sessionToken: sessionTokenMatch ? sessionTokenMatch[1] : null,
    expiration: expirationMatch ? expirationMatch[1] : null,
    bucketRegion: 'us-east-1',
  };
}

/**
 * Builds the 1-Click AWS Console CloudFormation Quick-Create review URL.
 *
 * This enables customers to deploy an S3 bucket and OIDC Trust Role in 1 click
 * directly from the AWS Console without having to manually copy-paste IAM JSON policies
 * or generate static IAM user keys.
 *
 * @param {object} params
 * @param {string} [params.region='us-east-1'] - AWS Region
 * @param {string} params.bucketName - Desired S3 bucket name
 * @param {string} [params.oidcClientId='https://accounts.google.com'] - OIDC Client ID / Audience
 * @param {string} [params.roleName='PortabaseS3RunnerRole'] - IAM Role Name
 * @param {string} [params.stackName='PortabaseS3Storage'] - CloudFormation Stack Name
 * @returns {string} 1-Click AWS Console URL
 */
export function buildAwsS3QuickCreateUrl({
  region = 'us-east-1',
  bucketName = 'my-portabase-backups',
  oidcClientId = 'https://accounts.google.com',
  roleName = 'PortabaseS3RunnerRole',
  stackName = 'PortabaseS3Storage',
} = {}) {
  const templateBaseUrl = 'https://s3.amazonaws.com/portabase-cloudformation-templates/s3-oidc-runner-role.yaml';
  const url = new URL(`https://${region}.console.aws.amazon.com/cloudformation/home`);
  url.searchParams.set('region', region);
  url.hash = `/stacks/create/review?stackName=${encodeURIComponent(stackName)}&templateURL=${encodeURIComponent(templateBaseUrl)}&param_BucketName=${encodeURIComponent(bucketName)}&param_OidcClientId=${encodeURIComponent(oidcClientId)}&param_RoleName=${encodeURIComponent(roleName)}`;
  return url.toString();
}

/**
 * Declarative AWS CloudFormation YAML template for 1-click S3 + OIDC IAM Role provisioning.
 *
 * @param {object} params
 * @param {string} params.bucketName
 * @param {string} params.oidcClientId
 * @param {string} params.roleName
 * @returns {string} YAML template string
 */
export function buildAwsS3OidcCloudFormationTemplate({
  bucketName = 'my-portabase-backups',
  oidcClientId = 'https://accounts.google.com',
  roleName = 'PortabaseS3RunnerRole',
} = {}) {
  return `AWSTemplateFormatVersion: '2010-09-09'
Description: 'Portabase S3 Storage with OIDC Web Identity Federation (Zero IAM Keys)'
Parameters:
  BucketName:
    Type: String
    Default: '${bucketName}'
    Description: 'Name of the S3 bucket for Portabase encrypted capsules'
  OidcClientId:
    Type: String
    Default: '${oidcClientId}'
    Description: 'OIDC Client ID / Audience from Google Cloud or Portabase Runner'
  RoleName:
    Type: String
    Default: '${roleName}'
    Description: 'Name of the IAM Role assumed by the Portabase Runner'

Resources:
  PortabaseBackupBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Ref BucketName
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      VersioningConfiguration:
        Status: Enabled

  PortabaseRunnerRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Ref RoleName
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              Federated: 'accounts.google.com'
            Action: 'sts:AssumeRoleWithWebIdentity'
            Condition:
              StringEquals:
                'accounts.google.com:aud': !Ref OidcClientId
      Policies:
        - PolicyName: PortabaseS3CapsuleAccess
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action:
                  - 's3:PutObject'
                  - 's3:GetObject'
                  - 's3:ListBucket'
                  - 's3:GetBucketLocation'
                Resource:
                  - !Sub 'arn:aws:s3:::\${BucketName}'
                  - !Sub 'arn:aws:s3:::\${BucketName}/*'

Outputs:
  RoleArn:
    Description: 'Role ARN to supply to Portabase Runner'
    Value: !GetAtt PortabaseRunnerRole.Arn
  BucketName:
    Description: 'S3 Bucket Name'
    Value: !Ref PortabaseBackupBucket
`;
}
