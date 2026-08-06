// Portabase capsule smoke — tiny Edge Function for Escape validation
Deno.serve(async (_req) => {
  return new Response(JSON.stringify({
    ok: true,
    name: "capsule-smoke",
    purpose: "portabase local capsule drill",
    ts: new Date().toISOString(),
  }), { headers: { "Content-Type": "application/json" } });
});
