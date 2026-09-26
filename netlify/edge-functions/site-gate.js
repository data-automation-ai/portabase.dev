// Staging gate: whole site behind a shared code. Casual barrier, not auth.
// The code lives in the SITE_GATE_CODE environment variable (Netlify UI) —
// never in this repo. API routes pass through untouched (they carry JWTs).
export default async function siteGate(request, context) {
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/')) {
    return context.next();
  }
  const code = Netlify.env.get('SITE_GATE_CODE');
  if (!code) {
    return new Response('Site gate is not configured yet.', { status: 503 });
  }
  const cookies = (request.headers.get('cookie') || '').split(';').map(c => c.trim());
  if (cookies.includes(`pb_gate=${code}`)) {
    return context.next();
  }
  if (request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    if (form && form.get('code') === code) {
      return new Response(null, {
        status: 303,
        headers: {
          location: '/',
          'set-cookie': `pb_gate=${code}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`,
        },
      });
    }
  }
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Portabase — private preview</title>` +
    `<style>body{margin:0;background:#0d0e11;color:#f7f6f1;font-family:Segoe UI,sans-serif;display:grid;place-items:center;min-height:100vh}form{border:1px solid #34353a;padding:32px;border-radius:8px;text-align:center}input{font-size:18px;padding:10px 14px;border-radius:6px;border:1px solid #34353a;background:#17181c;color:#f7f6f1;text-align:center;letter-spacing:.3em}button{margin-top:16px;font-size:15px;padding:10px 24px;border-radius:6px;border:0;background:#c9ff4a;color:#17181c;font-weight:700;cursor:pointer}</style></head><body>` +
    `<form method="post"><h1>Private preview</h1><p>Enter the access code.</p><input name="code" inputmode="numeric" autocomplete="off" autofocus><br><button type="submit">Enter</button></form>` +
    `</body></html>`,
    { status: 401, headers: { 'content-type': 'text/html' } },
  );
}
