import { randomUUID } from 'node:crypto';

const token = process.env.SQUARE_ACCESS_TOKEN;
const locationId = process.env.SQUARE_LOCATION_ID;
const environment = process.env.SQUARE_ENV || 'production';

if (!token || !locationId) {
  console.error('Missing SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID.');
  console.error('Set them in this terminal only, then run npm run square:create-link.');
  process.exit(1);
}

const baseUrl = environment === 'sandbox'
  ? 'https://connect.squareupsandbox.com'
  : 'https://connect.squareup.com';

const response = await fetch(`${baseUrl}/v2/online-checkout/payment-links`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'Square-Version': '2026-05-20'
  },
  body: JSON.stringify({
    idempotency_key: randomUUID(),
    description: 'Portabase Escape Kit — one-time purchase',
    quick_pay: {
      name: 'Portabase Escape Kit',
      price_money: { amount: 4700, currency: 'USD' },
      location_id: locationId
    },
    checkout_options: {
      allow_tipping: false,
      ask_for_shipping_address: false,
      redirect_url: 'https://portabase.dev/thanks',
      merchant_support_email: 'escape@portabase.dev'
    },
    payment_note: 'Portabase Escape Kit — one-time software purchase'
  })
});

const result = await response.json();

if (!response.ok) {
  console.error(`Square returned HTTP ${response.status}.`);
  console.error(JSON.stringify(result.errors || result, null, 2));
  process.exit(1);
}

console.log('\nSquare payment link created successfully.');
console.log(`Payment link ID: ${result.payment_link.id}`);
console.log(`Checkout URL: ${result.payment_link.url}`);
console.log('\nAdd this public URL to Cloudflare Pages:');
console.log(`VITE_SQUARE_CHECKOUT_URL=${result.payment_link.url}`);
