// Stand-ins for the outside services the platform talks to. Each one speaks the provider's real HTTP shape and is
// plugged in under the platform's real adapter classes, so request building, signatures and error handling are real.
// Test credentials the bots use (never real accounts):
export const TEST = {
  crawlerToken: 'bots-crawler-token-bots-crawler-token',
  platformRazorpay: { keyId: 'rzp_test_botplatform', keySecret: 'platform_secret', webhookSecret: 'platform_whsec' },
  storeRazorpay: { keyId: 'rzp_test_demo', keySecret: 'secret_value_1', webhookSecret: 'demo_webhook_secret' },
  shiprocket: { email: 'api-user@example.com', password: 'demo-api-pass' },
};

let seq = Date.now() % 100000000;

/** Razorpay Orders API as a store's gateway sees it. Only the test key id is accepted. */
export const storeRazorpayFetch = async (url, init) => {
  const u = String(url);
  const user = Buffer.from((new Headers(init?.headers).get('authorization') ?? '').slice(6), 'base64').toString().split(':')[0];
  if (user !== TEST.storeRazorpay.keyId) return new Response(JSON.stringify({ error: { description: 'Authentication failed' } }), { status: 401 });
  if (u.endsWith('/orders') && init?.method === 'POST') { const b = JSON.parse(init.body); return Response.json({ id: `order_H${++seq}`, amount: b.amount, currency: b.currency }); }
  if (u.includes('/refund')) return Response.json({ id: `rfnd_${++seq}`, status: 'processed' });
  return Response.json({ items: [] });
};

/** Razorpay Plans / Subscriptions / Orders for the platform's own billing account. */
export const platformBillingFetch = async (url, init) => {
  const u = String(url);
  if (u.endsWith('/plans')) return Response.json({ id: `plan_H${++seq}` });
  if (u.endsWith('/subscriptions')) return Response.json({ id: `sub_H${++seq}`, short_url: 'https://rzp.io/i/demo' });
  if (u.endsWith('/cancel')) return Response.json({ status: 'cancelled' });
  if (u.endsWith('/orders')) { const b = JSON.parse(init.body); return Response.json({ id: `order_B${++seq}`, amount: b.amount, currency: b.currency }); }
  if (u.endsWith('/customers')) return Response.json({ id: `cust_B${++seq}` });
  if (u.endsWith('/payments/create/recurring')) return Response.json({ razorpay_payment_id: `pay_R${++seq}` });
  return Response.json({});
};

/** Shiprocket external API: login, rates, booking, AWB, pickup, label, tracking, cancel. */
export const shiprocketFetch = async (url, init) => {
  const u = new URL(String(url)); const path = u.pathname.replace('/v1/external', ''); const b = init?.body ? JSON.parse(init.body) : null;
  if (path === '/auth/login') return b.password === TEST.shiprocket.password ? Response.json({ token: 'sr-demo' }) : new Response(JSON.stringify({ message: 'Invalid email and password combination' }), { status: 401 });
  if (path === '/courier/serviceability/') return Response.json({ data: { available_courier_companies: [{ courier_company_id: 10, courier_name: 'Delhivery Surface', rate: 96, estimated_delivery_days: '4' }, { courier_company_id: 33, courier_name: 'Blue Dart Air', rate: 148.5, estimated_delivery_days: '2' }, { courier_company_id: 54, courier_name: 'Ekart Logistics', rate: 88, estimated_delivery_days: '5' }] } });
  if (path === '/orders/create/adhoc') return Response.json({ order_id: ++seq, shipment_id: ++seq, status: 'NEW' });
  if (path === '/courier/assign/awb') return Response.json({ awb_assign_status: 1, response: { data: { awb_code: `1490${b.shipment_id}55`, courier_name: b.courier_id === '33' ? 'Blue Dart Air' : b.courier_id === '10' ? 'Delhivery Surface' : 'Ekart Logistics' } } });
  if (path === '/courier/generate/pickup') return Response.json({ pickup_status: 1, response: { pickup_scheduled_date: '2026-11-14 11:00:00' } });
  if (path === '/courier/generate/label') return Response.json({ label_created: 1, label_url: 'https://example.com/label.pdf' });
  if (path.startsWith('/courier/track/awb/')) return Response.json({ tracking_data: { track_url: `https://shiprocket.co/tracking/${path.split('/').pop()}`, shipment_track: [{ current_status: 'In Transit', edd: '2026-11-17 18:00:00' }], shipment_track_activities: [{ date: '2026-11-15 08:20:00', activity: 'Shipment in transit', location: 'Delhi hub' }, { date: '2026-11-14 12:05:00', activity: 'Picked up', location: 'New Delhi' }] } });
  if (path === '/orders/cancel') return Response.json({ status_code: 200 });
  return new Response('{}', { status: 404 });
};

/** Free AI provider model list (Groq's /models). */
export const discoveryFetch = async (url) => String(url) === 'https://api.groq.com/openai/v1/models'
  ? Response.json({ data: [{ id: 'openai/gpt-oss-120b', active: true, context_window: 131072 }, { id: 'qwen/qwen3-32b', active: true, context_window: 131072 }, { id: 'llama-3.1-8b-instant', active: true, context_window: 131072 }, { id: 'whisper-large-v3', active: true }] })
  : new Response('{}', { status: 404 });

/** MET Norway forecasts and Frankfurter exchange rates for full-stack apps. */
const metDoc = () => { const t0 = Math.floor(Date.now() / 3600000) * 3600000; return { properties: { meta: { updated_at: new Date(t0).toISOString() }, timeseries: Array.from({ length: 48 }, (_, h) => ({ time: new Date(t0 + h * 3600000).toISOString(), data: { instant: { details: { air_temperature: 24 + Math.sin(h / 4) * 4, relative_humidity: 55, wind_speed: 2.4 } }, next_1_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 0 } } } })) } }; };
export const servicesFetch = async (url) => {
  const u = new URL(String(url));
  if (u.host === 'api.met.no') return Response.json(metDoc(), { headers: { Expires: new Date(Date.now() + 1800000).toUTCString() } });
  if (u.host === 'api.frankfurter.dev') return Response.json({ amount: 1, base: u.searchParams.get('base'), date: '2026-11-13', rates: { INR: 88.4, EUR: 0.86, GBP: 0.76 } });
  return new Response('{}', { status: 404 });
};

/**
 * Stand-in for services/crawler (Crawl4AI). Same request and response shapes and token check; serves one fixed
 * small-business site, and refuses another the way the real reader does when robots.txt forbids it.
 */
export async function startCrawlerStandIn(port) {
  const { createServer } = await import('node:http');
  const site = 'https://kashmirwalnut.example/';
  const pages = [
    { url: site, title: 'Kashmir Walnut Co. | Fresh walnuts from Pulwama', description: 'Family orchard selling Kashmiri walnuts and kernels since 1987.', markdown: '# Kashmir Walnut Co.\nHand-picked walnuts from our family orchard in Pulwama, shipped across India within 3 days.\n![Our orchard](https://kashmirwalnut.example/img/orchard.jpg)', images: [{ src: 'https://kashmirwalnut.example/img/orchard.jpg', alt: 'Our orchard' }], links: [] },
    { url: `${site}about`, title: 'About us', description: '', markdown: 'Three generations of the Bhat family have tended these trees. We sun-dry every batch and never bleach our nuts.', images: [], links: [] },
    { url: `${site}products`, title: 'Products', description: '', markdown: '- Snow-white kernels, 500 g — ₹899\n- In-shell walnuts, 1 kg — ₹649\n- Gift box, 750 g — ₹1,299', images: [], links: [] },
    { url: `${site}contact`, title: 'Contact', description: '', markdown: 'Call +91 94190 12345 or email orders@kashmirwalnut.example. Orchard Road, Pulwama 192301.', images: [], links: [] },
  ];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const send = (status, body) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      if (req.url === '/health') return send(200, { ok: true });
      if (req.method !== 'POST' || req.url !== '/crawl') return send(404, { detail: 'not found' });
      if (req.headers['x-crawler-token'] !== TEST.crawlerToken) return send(401, { detail: 'unauthorised' });
      const { url = '', maxPages = 6 } = JSON.parse(raw || '{}');
      if (url.includes('kashmirwalnut.example')) return send(200, { url, host: 'kashmirwalnut.example', pages: pages.slice(0, maxPages), skipped: [{ url: `${site}admin/`, reason: 'robots.txt does not allow it' }], seconds: 1.4 });
      return send(422, { detail: `Couldn't read ${new URL(url).hostname}: robots.txt does not allow it` });
    });
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return server;
}
