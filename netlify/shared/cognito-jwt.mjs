import { CognitoJwtVerifier } from 'aws-jwt-verify';

let verifier;

function cognitoConfig() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID || process.env.VITE_COGNITO_USER_POOL_ID || 'us-east-1_xuKTz92hx';
  const clientId = process.env.COGNITO_CLIENT_ID || process.env.VITE_COGNITO_CLIENT_ID || '2mmmjhe11rvdpjaabi8fq5lgrv';
  const region = process.env.COGNITO_REGION || process.env.VITE_COGNITO_REGION || 'us-east-1';
  const domain = process.env.COGNITO_DOMAIN || process.env.VITE_COGNITO_DOMAIN || 'portabase-cloud-899867382621';
  return { userPoolId, clientId, region, domain };
}

export function getPublicAuthConfig() {
  const { userPoolId, clientId, region, domain } = cognitoConfig();
  return {
    userPoolId,
    clientId,
    region,
    domain,
    hostedUiBase: `https://${domain}.auth.${region}.amazoncognito.com`,
    trialDays: 7,
    priceMonthlyCents: 1700,
    listPriceMonthlyCents: 3400,
    currency: 'USD',
    promoUntil: '2026-08-31',
  };
}

function getVerifier() {
  if (!verifier) {
    const { userPoolId, clientId } = cognitoConfig();
    verifier = CognitoJwtVerifier.create({
      userPoolId,
      tokenUse: 'id',
      clientId,
    });
  }
  return verifier;
}

export async function verifyIdToken(authorizationHeader) {
  const raw = String(authorizationHeader || '');
  const match = raw.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('missing_bearer');
  const payload = await getVerifier().verify(match[1]);
  const email = payload.email || payload['cognito:username'] || '';
  if (!payload.sub || !email) throw new Error('invalid_claims');
  return {
    sub: payload.sub,
    email: String(email).toLowerCase(),
    name: payload.name || payload.given_name || '',
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    tokenUse: payload.token_use,
  };
}

export function jsonResponse(status, body, extraHeaders = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}
