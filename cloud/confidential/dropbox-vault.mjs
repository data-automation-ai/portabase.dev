import { generatePkcePair, generateOAuthState } from '../runner/supabase-oauth.mjs';
import { exchangeDropboxOAuthCode, refreshDropboxOAuthToken } from '../runner/storage-oauth.mjs';
import { testDropboxConnection } from '../../utility/cloud-storage-connectors.mjs';

const fail = code => { throw new Error(code); };
export function dropboxVault({ clientId, fetchImpl = fetch, now = Date.now } = {}) {
  if (!clientId || !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) fail('dropbox_app_not_configured');
  const secureFetch = (url, options) => fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  return {
    begin(profile) {
      const pkce = generatePkcePair(), state = generateOAuthState();
      profile.dropboxPending = { codeVerifier: pkce.codeVerifier, state, expires: now() + 10 * 60 * 1000 };
      const url = new URL('https://www.dropbox.com/oauth2/authorize');
      url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', token_access_type: 'offline',
        code_challenge: pkce.codeChallenge, code_challenge_method: 'S256', state }).toString();
      return { url: url.toString() };
    },
    async finish(profile, code) {
      const pending = profile.dropboxPending;
      if (!pending || pending.expires <= now() || typeof code !== 'string' || !/^[A-Za-z0-9_-]{10,4096}$/.test(code)) fail('dropbox_oauth_invalid');
      delete profile.dropboxPending;
      const tokens = await exchangeDropboxOAuthCode({ code, codeVerifier: pending.codeVerifier,
        clientId, redirectUri: undefined, fetchImpl: secureFetch });
      if (!tokens.refreshToken) fail('dropbox_refresh_token_required');
      await testDropboxConnection({ accessToken: tokens.accessToken, fetchImpl: secureFetch });
      profile.dropbox = tokens;
      return { connected: true, accountId: tokens.accountId || null };
    },
    async provider(profile) {
      let tokens = profile.dropbox;
      if (!tokens?.refreshToken) fail('dropbox_connection_required');
      if (!tokens.accessToken || !tokens.expiresAt || tokens.expiresAt <= now() + 90000) {
        const refreshed = await refreshDropboxOAuthToken({ refreshToken: tokens.refreshToken, clientId, fetchImpl: secureFetch });
        tokens = profile.dropbox = { ...tokens, ...refreshed };
      }
      await testDropboxConnection({ accessToken: tokens.accessToken, fetchImpl: secureFetch });
      return { type: 'dropbox', mode: 'api', folderPath: '/Portabase', refreshToken: tokens.refreshToken, clientId };
    },
  };
}
