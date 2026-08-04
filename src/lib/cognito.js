import { cognitoIdpBase, cognitoPublicDefaults, hostedUiBase, siteOrigin } from './auth-config.js';
import { clearSession, isTokenExpired, loadSession, saveSession } from './session.js';

async function cognitoCall(target, payload) {
  const response = await fetch(cognitoIdpBase(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.__type || data.message) {
    const type = String(data.__type || '').split('#').pop() || 'Error';
    const err = new Error(data.message || type);
    err.code = type;
    throw err;
  }
  return data;
}

function persistAuthResult(result, email) {
  const auth = result.AuthenticationResult || result;
  if (!auth?.IdToken) throw new Error('No tokens returned from Cognito.');
  saveSession({
    provider: 'aws',
    cloudVersion: 'aws',
    idToken: auth.IdToken,
    accessToken: auth.AccessToken,
    refreshToken: auth.RefreshToken || loadSession()?.refreshToken || null,
    expiresIn: auth.ExpiresIn,
    tokenType: auth.TokenType || 'Bearer',
    email: email || null,
    user: email ? { id: null, email, name: '' } : null,
  });
  return loadSession();
}

export async function signUpWithEmail({ email, password, name }) {
  const attrs = [{ Name: 'email', Value: email }];
  if (name) attrs.push({ Name: 'name', Value: name });
  return cognitoCall('SignUp', {
    ClientId: cognitoPublicDefaults.clientId,
    Username: email,
    Password: password,
    UserAttributes: attrs,
  });
}

export async function confirmSignUp({ email, code }) {
  return cognitoCall('ConfirmSignUp', {
    ClientId: cognitoPublicDefaults.clientId,
    Username: email,
    ConfirmationCode: code,
  });
}

export async function resendConfirmation({ email }) {
  return cognitoCall('ResendConfirmationCode', {
    ClientId: cognitoPublicDefaults.clientId,
    Username: email,
  });
}

export async function signInWithEmail({ email, password }) {
  const result = await cognitoCall('InitiateAuth', {
    AuthFlow: 'USER_PASSWORD_AUTH',
    ClientId: cognitoPublicDefaults.clientId,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });
  if (result.ChallengeName) {
    const err = new Error(`Additional challenge required: ${result.ChallengeName}`);
    err.code = result.ChallengeName;
    err.session = result.Session;
    throw err;
  }
  return persistAuthResult(result, email);
}

export async function forgotPassword({ email }) {
  return cognitoCall('ForgotPassword', {
    ClientId: cognitoPublicDefaults.clientId,
    Username: email,
  });
}

export async function confirmForgotPassword({ email, code, password }) {
  return cognitoCall('ConfirmForgotPassword', {
    ClientId: cognitoPublicDefaults.clientId,
    Username: email,
    ConfirmationCode: code,
    Password: password,
  });
}

export async function refreshSession() {
  const session = loadSession();
  if (!session?.refreshToken) return null;
  const result = await cognitoCall('InitiateAuth', {
    AuthFlow: 'REFRESH_TOKEN_AUTH',
    ClientId: cognitoPublicDefaults.clientId,
    AuthParameters: {
      REFRESH_TOKEN: session.refreshToken,
    },
  });
  return persistAuthResult({
    AuthenticationResult: {
      ...result.AuthenticationResult,
      RefreshToken: session.refreshToken,
    },
  }, session.email || session.user?.email);
}

export async function ensureFreshSession() {
  const session = loadSession();
  if (!session || session.cloudVersion !== 'aws') return null;
  const token = session.idToken || session.accessToken;
  if (!isTokenExpired(token)) return session;
  try {
    return await refreshSession();
  } catch {
    clearSession();
    return null;
  }
}

function callbackRedirectUri() {
  // Must match Cognito app client exactly (no query string)
  return `${siteOrigin()}/auth/callback`;
}

export function googleSignInUrl({ next = '/app' } = {}) {
  const state = `version:aws|next:${encodeURIComponent(next)}`;
  const params = new URLSearchParams({
    client_id: cognitoPublicDefaults.clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: callbackRedirectUri(),
    identity_provider: 'Google',
    state,
  });
  return `${hostedUiBase()}/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForTokens(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: cognitoPublicDefaults.clientId,
    code,
    redirect_uri: callbackRedirectUri(),
  });
  const response = await fetch(`${hostedUiBase()}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Token exchange failed');
  }
  saveSession({
    provider: 'aws',
    cloudVersion: 'aws',
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: data.expires_in,
    tokenType: data.token_type || 'Bearer',
  });
  return loadSession();
}

export function signOut() {
  clearSession();
  return `${hostedUiBase()}/logout?${new URLSearchParams({
    client_id: cognitoPublicDefaults.clientId,
    logout_uri: `${siteOrigin()}/`,
  }).toString()}`;
}

export function describeCognitoError(error) {
  const code = error?.code || '';
  const map = {
    UsernameExistsException: 'An account with this email already exists. Sign in instead.',
    UserNotConfirmedException: 'Confirm your email with the code we sent, then sign in.',
    NotAuthorizedException: 'Incorrect email or password.',
    UserNotFoundException: 'No account found for that email.',
    CodeMismatchException: 'That confirmation code is incorrect.',
    ExpiredCodeException: 'That code expired. Request a new one.',
    InvalidPasswordException: 'Password must be 12+ characters with upper, lower, number, and symbol.',
    InvalidParameterException: error.message || 'Check the form fields and try again.',
    LimitExceededException: 'Too many attempts. Wait a few minutes and try again.',
    TooManyRequestsException: 'Too many attempts. Wait a few minutes and try again.',
  };
  return map[code] || error.message || 'Authentication failed.';
}
