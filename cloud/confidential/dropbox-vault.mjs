import { generatePkcePair, generateOAuthState } from '../runner/supabase-oauth.mjs';
import { exchangeDropboxOAuthCode, refreshDropboxOAuthToken } from '../runner/storage-oauth.mjs';
import { testDropboxConnection, listDropboxCapsules } from '../../utility/cloud-storage-connectors.mjs';

const DROPBOX_CALLBACKS = new Set([
  'http://localhost:58441/oauth/dropbox/callback',
  'http://127.0.0.1:58441/oauth/dropbox/callback',
  'https://portabase.dev/oauth/dropbox/callback',
]);

const fail = code => { throw new Error(code); };
export function dropboxVault({ clientId, fetchImpl = fetch, now = Date.now } = {}) {
  if (!clientId || !/^[A-Za-z0-9_-]{8,80}$/.test(clientId)) fail('dropbox_app_not_configured');
  const secureFetch = (url, options) => fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(30000) });
  return {
    begin(profile, redirectUri) {
      if (redirectUri !== undefined && !DROPBOX_CALLBACKS.has(redirectUri)) fail('invalid_oauth_callback');
      const pkce = generatePkcePair(), state = generateOAuthState();
      profile.dropboxPending = { codeVerifier: pkce.codeVerifier, state, ...(redirectUri ? { redirectUri } : {}), expires: now() + 10 * 60 * 1000 };
      const url = new URL('https://www.dropbox.com/oauth2/authorize');
      url.search = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        token_access_type: 'offline',
        code_challenge: pkce.codeChallenge,
        code_challenge_method: 'S256',
        state,
        ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      }).toString();
      return { url: url.toString(), state, ...(redirectUri ? { redirectUri } : {}) };
    },
    async finish(profile, input) {
      const code = typeof input === 'string' ? input : input?.code;
      const state = typeof input === 'object' && input ? input.state : undefined;
      const pending = profile.dropboxPending;
      if (!pending || pending.expires <= now() || typeof code !== 'string' || !/^[A-Za-z0-9_-]{10,4096}$/.test(code)) fail('dropbox_oauth_invalid');
      if (pending.redirectUri || state !== undefined) {
        if (state !== pending.state) fail('dropbox_oauth_state_mismatch');
      }
      delete profile.dropboxPending;
      const tokens = await exchangeDropboxOAuthCode({
        code,
        codeVerifier: pending.codeVerifier,
        clientId,
        redirectUri: pending.redirectUri,
        fetchImpl: secureFetch,
      });
      if (!tokens.refreshToken) fail('dropbox_refresh_token_required');
      await testDropboxConnection({ accessToken: tokens.accessToken, fetchImpl: secureFetch });
      profile.dropbox = tokens;
      return { connected: true, accountId: tokens.accountId || null };
    },
    async importSession(profile,{provider,session}={}) {
      if(provider!=='dropbox'||!session||Object.keys(session).some(key=>!['accessToken','refreshToken','expiresAt'].includes(key))
        ||![session.accessToken,session.refreshToken].every(value=>typeof value==='string'&&/^[\x21-\x7e]{1,16384}$/.test(value))
        ||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now()||session.expiresAt>now()+24*60*60*1000)fail('invalid_dropbox_session');
      const account=await testDropboxConnection({accessToken:session.accessToken,fetchImpl:secureFetch});
      profile.dropbox={accessToken:session.accessToken,refreshToken:session.refreshToken,expiresAt:session.expiresAt,tokenType:'bearer'};
      delete profile.dropboxPending;profile.activeVault='dropbox';
      return {connected:true,accountId:account.accountId||null};
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
    async capsules(profile) {
      let tokens = profile.dropbox;
      if (!tokens?.refreshToken) fail('dropbox_connection_required');
      if (!tokens.accessToken || !tokens.expiresAt || tokens.expiresAt <= now() + 90000) {
        const refreshed = await refreshDropboxOAuthToken({ refreshToken: tokens.refreshToken, clientId, fetchImpl: secureFetch });
        tokens = profile.dropbox = { ...tokens, ...refreshed };
      }
      return await listDropboxCapsules({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, clientId, fetchImpl: secureFetch });
    },
  };
}
