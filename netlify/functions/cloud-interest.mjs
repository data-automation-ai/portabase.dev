import { getStore } from '@netlify/blobs';

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return null;
  return email;
}

export default async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  let body;
  try {
    body = await request.json();
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  // Honeypot
  if (body.companyWebsite) return json(200, { ok: true });

  const email = cleanEmail(body.email);
  if (!email) return json(400, { error: 'invalid_email' });

  const interest = {
    email,
    name: String(body.name || '').slice(0, 120),
    company: String(body.company || '').slice(0, 120),
    projects: String(body.projects || '').slice(0, 40),
    needs: String(body.needs || '').slice(0, 500),
    plan: String(body.plan || 'cloud-intro-17').slice(0, 80),
    priceMonthly: Number(body.priceMonthly) || 17,
    listPriceMonthly: Number(body.listPriceMonthly) || 34,
    promoUntil: String(body.promoUntil || '2026-08-31').slice(0, 32),
    source: 'portabase.dev',
    createdAt: new Date().toISOString(),
  };

  try {
    const store = getStore({ name: 'portabase-cloud-interest', consistency: 'strong' });
    await store.setJSON(`${Date.now()}-${email}`, interest);
    return json(200, { ok: true });
  } catch (error) {
    console.error('cloud_interest_failed', error.message);
    return json(503, { error: 'unavailable' });
  }
};
