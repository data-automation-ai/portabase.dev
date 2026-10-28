import { generatePkcePair, generateOAuthState, buildSupabaseAuthorizeUrl, exchangeSupabaseOAuthCode,
  refreshSupabaseAccessToken, DEFAULT_SUPABASE_OAUTH_TOKEN_URL } from '../runner/supabase-oauth.mjs';
import { supabaseAccess } from './supabase-access.mjs';
import {randomUUID} from 'node:crypto';
const SLOT = new Set(['source','target']);
const CALLBACKS=new Set(['https://portabase.dev/confidential/callback','http://127.0.0.1:58441/confidential/callback']);
const fail = code => { throw new Error(code); };
// Provider descriptions may contain private details. Preserve only fixed codes
// so the encrypted channel can diagnose failures without forwarding raw text.
const TOKEN_ERRORS = new Set(['invalid_grant','invalid_client','invalid_request',
  'unauthorized_client','unsupported_grant_type','invalid_scope','access_denied',
  'server_error','temporarily_unavailable','oauth_network_error','invalid_token_response']);
async function tokenOperation(action) {
  try { return await action(); }
  catch(error) { fail(TOKEN_ERRORS.has(error?.code) ? error.code : 'oauth_token_request_failed'); }
}
export function oauthConnections({ clientId, clientSecret, redirectUri, fetchImpl = fetch, now = Date.now }) {
  if (!clientId || !clientSecret || redirectUri !== 'https://portabase.dev/confidential/callback') fail('oauth_configuration_invalid');
  const refreshes=new WeakMap();let targetGrantAccess;
  const secureFetch=(url,options)=>fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
  async function identity(profile,slot) {
    if(profile.connections?.[slot]?.identity)return profile.connections[slot].identity;
    const {token}=await connections.access(profile,slot);
    const response=await secureFetch('https://api.supabase.com/v1/profile',{
      headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}}).catch(()=>null);
    if(!response?.ok)return profile.connections[slot].identity={verified:false};
    const user=await response.json().catch(()=>null);
    const id=typeof user?.gotrue_id==='string'?user.gotrue_id.trim():'';
    const email=typeof user?.primary_email==='string'?user.primary_email.trim().toLowerCase():'';
    if(!id||id.length>256||!email||email.length>320)return profile.connections[slot].identity={verified:false};
    return profile.connections[slot].identity={id,email,verified:true};
  }
  async function assertDistinct(profile) {
    const [source,target]=await Promise.all(['source','target'].map(slot=>identity(profile,slot)));
    if(source.verified&&target.verified){
      if(source.id===target.id||source.email===target.email)fail('destination_account_must_differ');
      return {source,target,method:'provider'};
    }
    const confirmation=profile.accountConfirmation;
    if(!confirmation||confirmation.sourceGrantId!==profile.connections.source.grantId||
      confirmation.targetGrantId!==profile.connections.target.grantId)fail('account_confirmation_required');
    if(confirmation.sourceEmail===confirmation.targetEmail)fail('destination_account_must_differ');
    return {source,target,method:'manual'};
  }
  const connections={
    setTargetGrantAccess(handler){targetGrantAccess=handler;},
    begin(profile, slot, callback=redirectUri) {
      if (!SLOT.has(slot)) fail('invalid_connection_slot');
      if(!CALLBACKS.has(callback))fail('invalid_oauth_callback');
      const pkce = generatePkcePair(), state = generateOAuthState();
      profile.pending ||= {};
      profile.pending[slot] = { state, codeVerifier: pkce.codeVerifier, redirectUri:callback, expires: now() + 10 * 60 * 1000 };
      const authorizeUrl = buildSupabaseAuthorizeUrl({ clientId, redirectUri:callback, codeChallenge: pkce.codeChallenge,
        state, scope: '', authorizeUrl: 'https://api.supabase.com/v1/oauth/authorize' });
      const url = slot === 'target' ? `${authorizeUrl}&prompt=login` : authorizeUrl;
      return { slot, state, url };
    },
    async finish(profile, {slot,code,state}) {
      if (!SLOT.has(slot) || typeof code !== 'string' || code.length > 4096 || !code.length) fail('invalid_oauth_callback');
      const pending = profile.pending?.[slot];
      if (!pending || pending.state !== state || pending.expires <= now()) fail('oauth_state_mismatch');
      if(!CALLBACKS.has(pending.redirectUri||redirectUri))fail('invalid_oauth_callback');
      delete profile.pending[slot];
      const tokens = await tokenOperation(()=>exchangeSupabaseOAuthCode({ code, codeVerifier: pending.codeVerifier, redirectUri:pending.redirectUri||redirectUri,
        clientId, clientSecret, tokenUrl: DEFAULT_SUPABASE_OAUTH_TOKEN_URL, fetchImpl:secureFetch }));
      const previous=profile.connections[slot];
      profile.connections[slot] = {...tokens,grantId:randomUUID()};
      try {
        const current=await identity(profile,slot);
        const other=slot==='source'?'target':'source';
        if(profile.connections[other]){
          const counterpart=await identity(profile,other);
          if(current.verified&&counterpart.verified&&
            (current.id===counterpart.id||current.email===counterpart.email))fail('destination_account_must_differ');
        }
        delete profile.accountConfirmation;
        return { slot, connected: true, identity:current };
      }catch(error){
        if(previous)profile.connections[slot]=previous;else delete profile.connections[slot];
        throw error;
      }
    },
    async importSession(profile,{slot,session}={}) {
      if(!SLOT.has(slot))fail('invalid_connection_slot');
      if(!session||Object.keys(session).some(key=>!['accessToken','refreshToken','expiresAt'].includes(key))
        ||![session.accessToken,session.refreshToken].every(value=>typeof value==='string'&&/^[\x21-\x7e]{1,16384}$/.test(value))
        ||!Number.isSafeInteger(session.expiresAt)||session.expiresAt<=now()||session.expiresAt>now()+24*60*60*1000)fail('invalid_oauth_session');
      // Hosted transport supplies only ciphertext to the browser. Provider API
      // checks still establish the grant's identity inside the enclave.
      await supabaseAccess(session.accessToken,secureFetch).projects().catch(()=>fail('invalid_oauth_session'));
      profile.connections||={};const previous=profile.connections[slot];
      profile.connections[slot]={accessToken:session.accessToken,refreshToken:session.refreshToken,expiresAt:session.expiresAt,tokenType:'bearer',grantId:randomUUID()};
      try{
        const current=await identity(profile,slot),other=slot==='source'?'target':'source';
        if(profile.connections[other]){const counterpart=await identity(profile,other);if(current.verified&&counterpart.verified&&(current.id===counterpart.id||current.email===counterpart.email))fail('destination_account_must_differ');}
        delete profile.accountConfirmation;return {slot,connected:true,method:'oauth',identity:current};
      }catch(error){if(previous)profile.connections[slot]=previous;else delete profile.connections[slot];throw error;}
    },
    async connectToken(profile, { slot, token } = {}) {
      if (!SLOT.has(slot)) fail('invalid_connection_slot');
      const cleanToken = typeof token === 'string' ? token.trim() : '';
      if (!cleanToken || !/^(?:sbp_[a-f0-9]{30,80}|[A-Za-z0-9_.-]{20,512})$/.test(cleanToken)) {
        fail('invalid_access_token');
      }
      try {
        await supabaseAccess(cleanToken, fetchImpl).projects();
      } catch {
        fail('invalid_access_token');
      }
      profile.connections ||= {};
      const previous = profile.connections[slot];
      profile.connections[slot] = {
        accessToken: cleanToken,
        tokenType: 'pat',
        grantId: randomUUID(),
      };
      try {
        const current = await identity(profile, slot);
        const other = slot === 'source' ? 'target' : 'source';
        if (profile.connections[other]) {
          const counterpart = await identity(profile, other);
          if (current.verified && counterpart.verified &&
            (current.id === counterpart.id || current.email === counterpart.email)) {
            fail('destination_account_must_differ');
          }
        }
        delete profile.accountConfirmation;
        return { slot, connected: true, method: 'token', identity: current };
      } catch (error) {
        if (previous) profile.connections[slot] = previous; else delete profile.connections[slot];
        throw error;
      }
    },
    async access(profile, slot, {delegated=true}={}) {
      if(slot==='target'&&delegated&&targetGrantAccess){const shared=await targetGrantAccess(profile);if(shared)return shared;}
      if (!SLOT.has(slot)) fail('invalid_connection_slot');
      let tokens = profile.connections?.[slot];
      if (!tokens?.accessToken) fail('supabase_connection_required');
      if (tokens.tokenType === 'pat') {
        return { token: tokens.accessToken, api: supabaseAccess(tokens.accessToken, fetchImpl) };
      }
      if (!tokens.refreshToken) fail('supabase_connection_required');
      if (!tokens.expiresAt || tokens.expiresAt <= now() + 90000) {
        let slots=refreshes.get(profile);if(!slots){slots=new Map();refreshes.set(profile,slots);}
        if(!slots.has(slot))slots.set(slot,(async()=>{
          try {
            const refreshed=await tokenOperation(()=>refreshSupabaseAccessToken({refreshToken:tokens.refreshToken,
              clientId,clientSecret,tokenUrl:DEFAULT_SUPABASE_OAUTH_TOKEN_URL,fetchImpl:secureFetch}));
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
      delete profile.connections[slot];delete profile.accountConfirmation;if (profile.pending) delete profile.pending[slot];
      return {slot,connected:false};
    },
    identity,
    assertDistinct,
    confirm(profile,{sourceEmail,targetEmail}){
      if(!profile.connections.source||!profile.connections.target)fail('supabase_connection_required');
      const clean=value=>typeof value==='string'?value.trim().toLowerCase():'';
      sourceEmail=clean(sourceEmail);targetEmail=clean(targetEmail);
      if(!/^[^\s@]{1,64}@[^\s@]{1,254}$/.test(sourceEmail)||
        !/^[^\s@]{1,64}@[^\s@]{1,254}$/.test(targetEmail))fail('invalid_account_email');
      if(sourceEmail===targetEmail)fail('destination_account_must_differ');
      if(profile.connections.source.identity?.verified&&profile.connections.source.identity.email!==sourceEmail)fail('account_email_mismatch');
      if(profile.connections.target.identity?.verified&&profile.connections.target.identity.email!==targetEmail)fail('account_email_mismatch');
      profile.connections.source.grantId ||= randomUUID();
      profile.connections.target.grantId ||= randomUUID();
      profile.accountConfirmation={sourceEmail,targetEmail,sourceGrantId:profile.connections.source.grantId,
        targetGrantId:profile.connections.target.grantId,method:'manual'};
      return {confirmed:true,method:'manual'};
    },
  };
  return connections;
}
