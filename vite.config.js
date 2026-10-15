import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export function portabaseCloudApiPlugin() {
  const routeMap = {
    '/api/cloud/promo-codes': './netlify/functions/cloud-promo-codes.mjs',
    '/api/cloud/redeem-test-promo': './netlify/functions/cloud-redeem-test-promo.mjs',
    '/api/cloud/unattended-restore': './netlify/functions/cloud-unattended-restore.mjs',
    '/api/cloud/storage-connectors': './netlify/functions/cloud-storage-connectors.mjs',
    '/api/cloud/me': './netlify/functions/cloud-me.mjs',
    '/api/cloud/subscribe': './netlify/functions/cloud-subscribe.mjs',
    '/api/cloud/confirm-checkout': './netlify/functions/cloud-confirm-checkout.mjs',
    '/api/cloud/self-refund': './netlify/functions/cloud-self-refund.mjs',
    '/api/cloud/jobs': './netlify/functions/cloud-jobs.mjs',
    '/api/cloud/runner-jobs': './netlify/functions/cloud-runner-jobs.mjs',
    '/api/cloud/dashboard': './netlify/functions/cloud-dashboard.mjs',
    '/api/cloud/telemetry': './netlify/functions/cloud-telemetry.mjs',
    '/api/cloud/telemetry-events': './netlify/functions/cloud-telemetry-events.mjs',
    '/api/cloud/runners': './netlify/functions/cloud-runners.mjs',
    '/api/cloud/agents': './netlify/functions/cloud-agents.mjs',
    '/api/cloud/schedules': './netlify/functions/cloud-schedules.mjs',
    '/api/cloud/notification-destinations': './netlify/functions/cloud-notification-destinations.mjs',
    '/api/cloud/notification-preferences': './netlify/functions/cloud-notification-preferences.mjs',
    '/api/cloud/notification-history': './netlify/functions/cloud-notification-history.mjs',
    '/api/cloud/interest': './netlify/functions/cloud-interest.mjs',
    '/api/cloud/manifest-sharing': './netlify/functions/cloud-manifest-sharing.mjs',
    '/api/cloud/cancel-subscription': './netlify/functions/cloud-cancel-subscription.mjs',
    '/api/auth/config': './netlify/functions/auth-config.mjs',
  };

  const handleRequest = (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname.replace(/\/$/, '') || '/';
    const handlerPath = routeMap[pathname];

    if (!handlerPath) {
      return next();
    }

    const chunks = [];
    req.on('data', chunk => { chunks.push(chunk); });
    req.on('end', async () => {
      try {
        const body = chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null;
        const absHandlerPath = (await import('node:path')).default.resolve(process.cwd(), handlerPath);
        const { pathToFileURL } = await import('node:url');
        const mod = await import(pathToFileURL(absHandlerPath).href);
        const fn = mod.handler || mod.default;
        if (typeof fn !== 'function') {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'handler_not_found' }));
          return;
        }
        const event = {
          httpMethod: req.method,
          path: pathname,
          queryStringParameters: Object.fromEntries(url.searchParams.entries()),
          headers: req.headers,
          body,
        };
        const response = await fn(event, {});
        res.statusCode = response.statusCode || 200;
        if (response.headers) {
          for (const [k, v] of Object.entries(response.headers)) {
            res.setHeader(k, v);
          }
        }
        res.end(response.body || '');
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'function_error', message: err.message }));
      }
    });
  };

  return {
    name: 'portabase-cloud-api-plugin',
    configureServer(server) {
      server.middlewares.use(handleRequest);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handleRequest);
    },
  };
}

export default defineConfig({
  plugins: [react(), portabaseCloudApiPlugin()],
  appType: 'spa',
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
