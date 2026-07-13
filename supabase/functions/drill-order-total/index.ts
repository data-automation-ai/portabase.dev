Deno.serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return new Response(JSON.stringify({ error: 'Supabase runtime credentials unavailable' }), { status: 500 });
  const response = await fetch(`${url}/rest/v1/rpc/portabase_drill_order_total`, {
    method: 'POST',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const text = await response.text();
  return new Response(JSON.stringify({ ok: response.ok, total: response.ok ? JSON.parse(text) : null, upstreamStatus: response.status }), {
    status: response.ok ? 200 : 502,
    headers: { 'content-type': 'application/json' },
  });
});
