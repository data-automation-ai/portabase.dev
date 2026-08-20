/**
 * Google ID-token sign-in for Portabase Cloud (web).
 *
 * Uses Google's implicit `response_type=id_token` and hands the token to
 * supabase.auth.signInWithIdToken. This deliberately avoids Supabase's
 * server-side authorization-code exchange, which fails with "Unable to exchange
 * external code" against this client configuration.
 *
 * Does NOT use Google One Tap / FedCM (403 + AbortError on this client type,
 * and it degrades silently). Popup first; full-page redirect only when the
 * popup is blocked. No in-page modal, so the login button layout stays put.
 *
 * Storage keys and the postMessage type are Portabase-specific so another app
 * sharing the browser cannot read an in-flight token.
 */

/**
 * Web OAuth client for Google -> id_token -> Supabase signInWithIdToken.
 *
 * The Supabase Auth Google provider must be configured with this same client id,
 * because Supabase validates it against the token's `aud` claim. OAuth client
 * ids are public identifiers, but they must never be shared between products —
 * a shared client signs users into every app bound to it.
 */
export const GOOGLE_WEB_CLIENT_ID = String(
  import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '',
).trim();

export const GOOGLE_ID_TOKEN_MESSAGE = 'portabase-google-id-token';
export const GOOGLE_ID_FLOW_KEY = 'portabase_google_id_flow';
export const GOOGLE_ID_NONCE_KEY = 'portabase_google_id_nonce';
export const GOOGLE_ID_TOKEN_KEY = 'portabase_google_id_token';

/** Callback path registered on the OAuth client. Must match exactly. */
export const GOOGLE_REDIRECT_PATH = '/auth/callback';

export function googleRedirectUri() {
  const origin = window.location.origin.replace(/\/$/, '');
  return `${origin}${GOOGLE_REDIRECT_PATH}`;
}

function randomNonce() {
  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

function buildGoogleAuthUrl(clientId, redirectUri, nonce) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'id_token',
    response_mode: 'fragment',
    scope: 'openid email profile',
    nonce,
    prompt: 'select_account',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export function parseIdTokenFromUrl(href) {
  try {
    const hashIdx = String(href).indexOf('#');
    if (hashIdx < 0) return {};
    const hashParams = new URLSearchParams(String(href).slice(hashIdx + 1));
    const idToken = hashParams.get('id_token') || undefined;
    const error = hashParams.get('error_description') || hashParams.get('error') || undefined;
    return {
      idToken,
      error: error ? decodeURIComponent(error.replace(/\+/g, ' ')) : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * Open the Google OAuth popup and recover the id_token via postMessage and/or
 * same-origin location polling. COOP can sever `window.opener`, so neither
 * channel alone is reliable — both run.
 */
function requestGoogleIdTokenViaPopup(clientId, redirectUri, nonce) {
  const authUrl = buildGoogleAuthUrl(clientId, redirectUri, nonce);

  const w = 500;
  const h = 640;
  const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - w) / 2));
  const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - h) / 2));
  const features = `popup=yes,width=${w},height=${h},left=${left},top=${top},menubar=no,toolbar=no`;

  // Opened synchronously in the click handler stack so browsers allow the popup.
  // Any await before this point gets it treated as unsolicited and blocked.
  const popup = window.open(authUrl, 'portabase_google_oauth', features);
  if (!popup) return Promise.reject(new Error('POPUP_BLOCKED'));

  try {
    popup.focus();
  } catch {
    /* ignore */
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    // True once the popup actually navigated back to our origin. Distinguishes
    // "user closed the account chooser" from "Google refused the request and
    // never came back" (e.g. redirect_uri_mismatch).
    let reachedOurOrigin = false;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      clearInterval(poll);
      clearTimeout(hardTimeout);
    };

    const finish = (err, token) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (popup && !popup.closed) popup.close();
      } catch {
        /* ignore */
      }
      if (err) reject(err);
      else if (token) resolve(token);
      else reject(new Error('No Google credential returned'));
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== GOOGLE_ID_TOKEN_MESSAGE) return;
      // A same-origin postMessage from the callback page means Google did come back.
      reachedOurOrigin = true;
      if (data.error) {
        finish(new Error(String(data.error)));
        return;
      }
      if (data.idToken) finish(undefined, String(data.idToken));
    };

    window.addEventListener('message', onMessage);

    const poll = setInterval(() => {
      if (settled) return;
      try {
        if (popup.closed) {
          // A closed popup does NOT necessarily mean the user cancelled. If
          // Google rejected the request (most commonly redirect_uri_mismatch —
          // this origin's /auth/callback is not on the client's Authorized
          // redirect URIs), it shows its own "Access blocked" page and never
          // returns a token, so closing it lands here too. Say so, otherwise a
          // real misconfiguration is reported to the user as "you cancelled".
          if (!reachedOurOrigin) {
            finish(new Error(
              `Google did not return to ${window.location.origin}. If you saw `
              + '"Access blocked" / redirect_uri_mismatch, add '
              + `${redirectUri} to the Authorized redirect URIs for client `
              + `${clientId.split('-')[0]}… in Google Cloud Console.`,
            ));
            return;
          }
          finish(new Error('Google sign-in was cancelled.'));
          return;
        }
        // Throws while still on accounts.google.com
        const href = popup.location.href;
        if (!href || href === 'about:blank') return;
        if (!href.startsWith(window.location.origin)) return;
        reachedOurOrigin = true;

        const { idToken, error } = parseIdTokenFromUrl(href);
        if (error) {
          finish(new Error(error));
          return;
        }
        if (idToken) finish(undefined, idToken);
      } catch {
        // Cross-origin until the redirect completes — expected.
      }
    }, 300);

    const hardTimeout = setTimeout(() => {
      finish(new Error('Google sign-in timed out. Please try again.'));
    }, 120000);
  });
}

/** Full-page redirect fallback, used only when the popup is blocked. */
function requestGoogleIdTokenViaRedirect(clientId, redirectUri, nonce) {
  try {
    sessionStorage.setItem(GOOGLE_ID_FLOW_KEY, '1');
    sessionStorage.setItem(GOOGLE_ID_NONCE_KEY, nonce);
  } catch {
    /* ignore */
  }
  window.location.assign(buildGoogleAuthUrl(clientId, redirectUri, nonce));
  // Page navigates away.
  throw new Error('REDIRECTING');
}

/**
 * Start Google ID-token sign-in. Call only from a user gesture (button click).
 * Resolves to `{ idToken, nonce }` — the nonce must be handed to
 * signInWithIdToken so Supabase can match it against the token's nonce claim.
 */
export async function requestGoogleIdToken(clientId = GOOGLE_WEB_CLIENT_ID) {
  if (typeof window === 'undefined') throw new Error('Google sign-in is web-only');
  if (!clientId) {
    throw new Error(
      'Google sign-in is not configured for this deployment. Missing VITE_GOOGLE_OAUTH_CLIENT_ID.',
    );
  }

  const redirectUri = googleRedirectUri();
  const nonce = randomNonce();

  try {
    sessionStorage.setItem(GOOGLE_ID_NONCE_KEY, nonce);
  } catch {
    /* ignore */
  }

  try {
    const idToken = await requestGoogleIdTokenViaPopup(clientId, redirectUri, nonce);
    return { idToken, nonce };
  } catch (err) {
    const msg = err?.message || String(err);
    if (msg === 'POPUP_BLOCKED') {
      // Full-page navigation — does not return.
      requestGoogleIdTokenViaRedirect(clientId, redirectUri, nonce);
    }
    throw err instanceof Error ? err : new Error(msg);
  }
}

/**
 * If a full-page Google ID flow left a token in sessionStorage, return it once
 * along with the nonce that was used to request it.
 */
export function consumeStoredGoogleIdToken() {
  if (typeof window === 'undefined') return null;
  try {
    const idToken = sessionStorage.getItem(GOOGLE_ID_TOKEN_KEY);
    if (!idToken) return null;
    const nonce = sessionStorage.getItem(GOOGLE_ID_NONCE_KEY) || undefined;
    sessionStorage.removeItem(GOOGLE_ID_TOKEN_KEY);
    sessionStorage.removeItem(GOOGLE_ID_FLOW_KEY);
    sessionStorage.removeItem(GOOGLE_ID_NONCE_KEY);
    return { idToken, nonce };
  } catch {
    return null;
  }
}

/** True when a full-page (popup-blocked) Google flow is in progress. */
export function googleRedirectFlowPending() {
  try {
    return sessionStorage.getItem(GOOGLE_ID_FLOW_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Run on the callback page. If the URL fragment carries a Google id_token,
 * hand it to the opener (popup path) and stash it for the redirect path.
 * Returns true when this was a Google id_token callback.
 */
export function deliverGoogleIdTokenFromCallback() {
  if (typeof window === 'undefined') return false;
  const { idToken, error } = parseIdTokenFromUrl(window.location.href);
  if (!idToken && !error) return false;

  if (idToken) {
    try {
      sessionStorage.setItem(GOOGLE_ID_TOKEN_KEY, idToken);
    } catch {
      /* ignore */
    }
  }

  // Popup path: tell the opener. COOP may have severed window.opener, in which
  // case the opener's location polling picks the token out of the URL instead.
  try {
    if (window.opener && window.opener !== window) {
      window.opener.postMessage(
        { type: GOOGLE_ID_TOKEN_MESSAGE, idToken, error },
        window.location.origin,
      );
    }
  } catch {
    /* ignore */
  }
  return true;
}
