import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { UI_HOST, SECURITY_HEADERS } from './server.mjs';
import { createPrivateCapsuleReview, REVIEW_BODY_BYTES } from './private-capsule-review.mjs';

const matches = (a, b) => typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const errors = new Set(['capsule_review_busy', 'capsule_review_changed', 'capsule_changed', 'capsule_review_limit', 'capsule_file_refused', 'capsule_path_refused',
  'capsule_passphrase_required', 'capsule_authentication_failed', 'unsupported_capsule_archive', 'unsupported_capsule_sql', 'invalid_capsule_metadata',
  'invalid_capsule_manifest', 'capsule_binding_mismatch', 'capsule_baseline_required', 'invalid_capture_log', 'invalid_restore_selection', 'empty_restore_selection', 'restore_plan_over_budget',
  'invalid_replay_confirmation', 'private_replay_setup_required', 'replay_target_confirmation_required', 'restore_plan_binding_mismatch', 'restore_plan_changed',
  'invalid_shared_summary_request']);
export async function startCapsuleReviewServer({ privateReview, port = 0, token = randomBytes(24).toString('hex') }) {
  const review = await createPrivateCapsuleReview(privateReview), csrf = randomBytes(24).toString('hex');
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json') => { response.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': `${type}; charset=utf-8` }); response.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    try {
      const host = request.headers.host;
      if (![`${UI_HOST}:${server.address().port}`, `localhost:${server.address().port}`].includes(host)) return send(421, { error: 'loopback_host_required' });
      const origin = `http://${host}`, url = new URL(request.url, origin);
      if (request.headers.origin && request.headers.origin !== origin) return send(403, { error: 'origin_refused' });
      const assets = { '/': ['capsule-review/index.html', 'text/html'], '/app.js': ['capsule-review/app.js', 'text/javascript'], '/app.css': ['private/app.css', 'text/css'], '/review.css': ['capsule-review/review.css', 'text/css'] };
      if (request.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname]; return send(200, await readFile(new URL(`./static/${name}`, import.meta.url), 'utf8'), type);
      }
      if (!matches(token, request.headers['x-portabase-session'])) return send(401, { error: 'session_required' });
      if (request.method === 'GET' && url.pathname === '/api/review') return send(200, { ...review.bootstrap(), csrf });
      const actions = { '/api/review/inspect': review.inspect, '/api/review/plans': review.save,
        '/api/review/shareable-summary': review.shareableSummary, '/api/review/replay-reference': review.createReplayReference };
      if (request.method !== 'POST' || !Object.hasOwn(actions, url.pathname)) return send(405, { error: 'method_refused' });
      if (request.headers.origin !== origin || !matches(csrf, request.headers['x-portabase-csrf'])
        || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') return send(403, { error: 'csrf_refused' });
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return send(415, { error: 'json_required' });
      if (Number(request.headers['content-length'] || 0) > REVIEW_BODY_BYTES) return send(413, { error: 'body_too_large' });
      let size = 0; const chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > REVIEW_BODY_BYTES) return send(413, { error: 'body_too_large' }); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks)); } catch { return send(400, { error: 'invalid_json' }); }
      return send(['/api/review/inspect', '/api/review/shareable-summary'].includes(url.pathname) ? 200 : 201, await actions[url.pathname](body));
    } catch (error) { send(errors.has(error.code) ? 409 : 503, { error: errors.has(error.code) ? error.code : 'capsule_review_unavailable' }); }
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, UI_HOST, resolve); });
  const address = server.address();
  return { server, token, address, url: `http://${UI_HOST}:${address.port}/#t=${token}`, close: () => new Promise(resolve => server.close(resolve)) };
}
