/**
 * `portabase ui` — a read-only local window onto the CLI's own view of a project.
 *
 * Locality guarantees (each one is asserted in tests/ui-server.test.mjs):
 *   - Listens on 127.0.0.1 only. Nothing off this machine can connect.
 *   - The page's CSP allows network calls to 'self' only; the browser itself
 *     refuses any request to another origin, including Portabase and Supabase.
 *   - Host header must be the loopback address (blocks DNS rebinding).
 *   - API needs a per-launch random session token (other local pages and
 *     processes cannot read it) and rejects cross-origin requests.
 *   - GET only. No endpoint writes, backs up, restores, or deletes anything.
 *   - Credentials stay in this process's environment; responses carry names,
 *     counts and sizes only.
 */
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const UI_HOST = '127.0.0.1';

export const UI_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const SECURITY_HEADERS = Object.freeze({
  'Content-Security-Policy': UI_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
});

const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), 'static');
export const STATIC_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/app.css': ['app.css', 'text/css; charset=utf-8'],
});

function tokenMatches(expected, received) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(received || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * @param {{ collect: () => Promise<object>, port?: number, token?: string }} options
 * collect() returns the snapshot JSON; it is called on first load and on refresh.
 */
export async function startUiServer({ collect, collectBucketObjects, privateSetup, privateReview, port = 0, token = randomBytes(24).toString('hex') }) {
  if (privateReview !== undefined) {
    if (privateSetup !== undefined) throw new Error('Choose one private UI mode.');
    const { startCapsuleReviewServer } = await import('./capsule-review-server.mjs');
    return startCapsuleReviewServer({ privateReview, port, token });
  }
  if (privateSetup !== undefined) {
    const { startPrivateSetupUiServer } = await import('./private-server.mjs');
    return startPrivateSetupUiServer({ collect, collectBucketObjects, privateSetup, port, token });
  }
  let snapshot = null;
  let pending = null;
  const refresh = () => {
    pending ||= collect().then(result => { snapshot = result; return result; }).finally(() => { pending = null; });
    return pending;
  };

  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type });
      response.end(body);
    };
    try {
      const { port: boundPort } = server.address();
      const allowedHosts = [`${UI_HOST}:${boundPort}`, `localhost:${boundPort}`];
      if (!allowedHosts.includes(request.headers.host)) return send(421, JSON.stringify({ error: 'Loopback host only.' }));
      if (request.method !== 'GET') return send(405, JSON.stringify({ error: 'Read-only.' }));
      const origin = request.headers.origin;
      if (origin && !allowedHosts.map(host => `http://${host}`).includes(origin)) return send(403, JSON.stringify({ error: 'Cross-origin request refused.' }));

      const url = new URL(request.url, `http://${request.headers.host}`);
      const asset = STATIC_FILES[url.pathname];
      if (asset) return send(200, await readFile(join(STATIC_DIR, asset[0])), asset[1]);

      if (url.pathname === '/api/snapshot') {
        if (!tokenMatches(token, request.headers['x-portabase-session'])) return send(401, JSON.stringify({ error: 'Session token required.' }));
        const result = url.searchParams.get('refresh') === '1' || !snapshot ? await refresh() : snapshot;
        return send(200, JSON.stringify(result));
      }
      return send(404, JSON.stringify({ error: 'Not found.' }));
    } catch (error) {
      return send(500, JSON.stringify({ error: error.message }));
    }
  });

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, UI_HOST, resolveListen);
  });
  const address = server.address();
  return {
    server,
    token,
    address,
    url: `http://${UI_HOST}:${address.port}/#t=${token}`,
    close: () => new Promise(resolveClose => server.close(() => resolveClose())),
  };
}
