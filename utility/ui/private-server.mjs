import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { UI_HOST, SECURITY_HEADERS } from './server.mjs';
import { createPrivateSetup, PRIVATE_SETUP_MAX_BYTES } from './private-setup.mjs';
import { openRunnerState } from '../../cloud/runner/runner-state.mjs';
import { loadPrivateRuntimeSecrets, privateRuntimeSecretStatus, runtimeSecretUpdates, savePrivateRuntimeSecrets } from '../../cloud/runner/runtime-secrets.mjs';

const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/app.css': ['app.css', 'text/css'] };
const safeErrors = new Set(['inventory_unavailable', 'inventory_changed', 'private_setup_busy', 'invalid_selection',
  'empty_selection_confirmation_required', 'private_config_too_large', 'private_scratch_unavailable',
  'invalid_runtime_secrets', 'invalid_source_url', 'invalid_source_database_url', 'invalid_source_database_password', 'invalid_source_service_key',
  'invalid_source_access_token', 'invalid_capsule_passphrase', 'invalid_target_project', 'invalid_target_url',
  'invalid_target_service_key', 'invalid_target_database_url', 'invalid_target_database_password', 'incomplete_target_configuration',
  'runtime_secrets_too_large']);
const safeError = error => safeErrors.has(error?.code) ? error.code : 'private_setup_unavailable';
const matches = (expected, value) => typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(expected)
  && timingSafeEqual(Buffer.from(expected), Buffer.from(value));
export async function startPrivateSetupUiServer({ collect, privateSetup, port = 0, token = randomBytes(24).toString('hex') }) {
  const stateStore = await openRunnerState(privateSetup);
  const stored = await loadPrivateRuntimeSecrets(privateSetup);
  Object.assign(process.env, stored.env);
  const setup = await createPrivateSetup({ ...privateSetup, collect, stateStore });
  const csrf = randomBytes(24).toString('hex');
  const server = createServer(async (request, response) => {
    const send = (status, body, type = 'application/json') => {
      response.writeHead(status, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': `${type}; charset=utf-8` });
      response.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    try {
      const boundPort = server.address().port;
      const host = request.headers.host;
      if (![`${UI_HOST}:${boundPort}`, `localhost:${boundPort}`].includes(host)) return send(421, { error: 'loopback_host_required' });
      const origin = `http://${host}`;
      if (request.headers.origin && request.headers.origin !== origin) return send(403, { error: 'origin_refused' });
      const url = new URL(request.url, origin);
      if (request.method === 'GET' && assets[url.pathname]) {
        const [name, type] = assets[url.pathname];
        return send(200, await readFile(fileURLToPath(new URL(`./static/private/${name}`, import.meta.url)), 'utf8'), type);
      }
      if (request.method === 'GET' && url.pathname === '/favicon.ico') return send(204, '', 'image/x-icon');
      if (!matches(token, request.headers['x-portabase-session'])) return send(401, { error: 'session_required' });
      if (request.method === 'GET' && url.pathname === '/api/bootstrap') {
        const current = await loadPrivateRuntimeSecrets(privateSetup);
        return send(200, { ...await setup.bootstrap(),
          connections: privateRuntimeSecretStatus({ ...process.env, ...current.env }, current.status.updatedAt), csrf });
      }
      if (request.method === 'GET' && url.pathname === '/api/setup-stream') {
        response.writeHead(200, { ...SECURITY_HEADERS, 'Cache-Control': 'no-store',
          'Content-Type': 'application/x-ndjson; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
        const write = value => { if (!response.destroyed && !response.writableEnded) response.write(`${JSON.stringify(value)}\n`); };
        write({ type: 'start' });
        try {
          const result = await setup.inspect(write);
          write({ type: 'complete', inventory: { ...result, csrf } });
        } catch (error) {
          write({ type: 'error', error: safeError(error) });
        }
        if (!response.writableEnded) response.end();
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/setup') return send(200, { ...await setup.inspect(), csrf });
      if (request.method !== 'POST' || !['/api/configurations', '/api/connections'].includes(url.pathname)) return send(405, { error: 'method_refused' });
      if (request.headers.origin !== origin || !matches(csrf, request.headers['x-portabase-csrf'])
        || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') return send(403, { error: 'csrf_refused' });
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '')) return send(415, { error: 'json_required' });
      if (Number(request.headers['content-length'] || 0) > PRIVATE_SETUP_MAX_BYTES) return send(413, { error: 'body_too_large' });
      let size = 0; const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > PRIVATE_SETUP_MAX_BYTES) return send(413, { error: 'body_too_large' });
        chunks.push(chunk);
      }
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(400, { error: 'invalid_json' }); }
      if (url.pathname === '/api/connections') {
        const saved = await savePrivateRuntimeSecrets(privateSetup, runtimeSecretUpdates(body, privateSetup.projectRef));
        Object.assign(process.env, saved.env);
        stateStore.recordEvent('connections.updated', 'ready', {
          sourceConfigured: saved.status.sourceConfigured, targetConfigured: saved.status.targetConfigured,
          passphraseConfigured: saved.status.passphraseConfigured,
        });
        return send(201, { saved: true, connections: saved.status });
      }
      return send(201, await setup.save(body));
    } catch (error) {
      const code = safeError(error);
      return send(safeErrors.has(error.code) ? error.status || 400 : 503, { error: code });
    }
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, UI_HOST, resolve); });
  const address = server.address();
  return { server, token, address, url: `http://${UI_HOST}:${address.port}/#t=${token}`,
    close: () => new Promise(resolve => server.close(() => { stateStore.close(); resolve(); })) };
}
