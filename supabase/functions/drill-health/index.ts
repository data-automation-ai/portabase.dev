Deno.serve(() => new Response(JSON.stringify({ ok: true, fixture: 'portabase_restore_drill' }), {
  headers: { 'content-type': 'application/json' },
}));
