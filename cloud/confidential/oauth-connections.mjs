import { generatePkcePair, generateOAuthState, buildSupabaseAuthorizeUrl, exchangeSupabaseOAuthCode,
  refreshSupabaseAccessToken, DEFAULT_SUPABASE_OAUTH_TOKEN_URL } from '../runner/supabase-oauth.mjs';
import { supabaseAccess } from './supabase-access.mjs';
const SLOT = new Set(['source','target']);
const fail = code => { throw new Error(code); };
export function oauthConnections({ clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now }) {
  if (!clientId || !clientSecret || redirectUri !== 'https://portabase.dev/confidential/callback') fail('oauth_configuration_invalid');
  const refreshes=new WeakMap();
  const secureFetch=(url,options)=>fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
  return {
    begin(profile, slot) {
      if (!SLOT.has(slot)) fail('invalid_connection_slot');
      const pkce = generatePkcePair(), state = generateOAuthState();
      profile.pending ||= {};
      profile.pending[slot] = { state, codeVerifier: pkce.codeVerifier, expires: now() + 10 * 60 * 1000 };
      return { slot, state, url: buildSupabaseAuthorizeUrl({ clientId, redirectUri, codeChallenge: pkce.codeChallenge,
        state, scope: '', authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize' }) };
    },
    async finish(profile, {slot,code,state}) {
      if (!SLOT.has(slot) || typeof code !== 'string' || code.length > 4096 || !code.length) fail('invalid_oauth_callback');
      const pending = profile.pending?.[slot];
      if (!pending || pending.state !== state || pending.expires <= now()) fail('oauth_state_mismatch');
      delete profile.pending[slot];
      const tokens = await exchangeSupabaseOAuthCode({ code, codeVerifier: pending.codeVerifier, redirectUri,
        clientId, clientSecret, tokenUrl: DEFAULT_SUPABASE_OAUTH_TOKEN_URL, fetchImpl:secureFetch });
      profile.connections[slot] = tokens;
      return { slot, connected: true };
    },
    async access(profile, slot) {
      if (!SLOT.has(slot)) fail('invalid_connection_slot');
      let tokens = profile.connections?.[slot];
      if (!tokens?.accessToken || !tokens.refreshToken) fail('supabase_connection_required');
      if (!tokens.expiresAt || tokens.expiresAt <= now() + 90000) {
        let slots=refreshes.get(profile);if(!slots){slots=new Map();refreshes.set(profile,slots);}
        if(!slots.has(slot))slots.set(slot,(async()=>{
          try {
            const refreshed=await refreshSupabaseAccessToken({refreshToken:tokens.refreshToken,
              clientId,clientSecret,tokenUrl:DEFAULT_SUPABASE_OAUTH_TOKEN_URL,fetchImpl:secureFetch});
            // Disconnect or reauthorization must not resurrect an older grant.
            if(profile.connections[slot]!==tokens)fail('connection_changed');
            profile.connections[slot]={...tokens,...refreshed};
            return profile.connections[slot];
          } finally {slots.delete(slot);}
        })());
        tokens=await slots.get(slot);
      }
      return { token: tokens.accessToken, api: supabaseAccess(tokens.accessToken,fetchImpl) };
    },
    disconnect(profile,slot) {
      if (!SLOT.has(slot)) fail('invalid_connection_slot');
      delete profile.connections[slot]; if (profile.pending) delete profile.pending[slot];
      return {slot,connected:false};
    },
  };
}
