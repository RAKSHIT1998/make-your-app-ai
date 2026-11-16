// Boots the real, built API (apps/api/dist) with stand-ins for AI and outside providers. Started by start.mjs.
// Never point this at a production database: start.mjs creates and owns a throwaway one.
import { freeGroq, scriptedProvider } from './ai.mjs';
import { TEST, startCrawlerStandIn, discoveryFetch, platformBillingFetch, servicesFetch, shiprocketFetch, storeRazorpayFetch } from './emulators.mjs';

const A = new URL('../../../apps/api/', import.meta.url).href;
const imp = (p) => import(new URL(p, A).href);
await imp('node_modules/reflect-metadata/Reflect.js');
const { NestFactory } = await imp('node_modules/@nestjs/core/index.js');
const { AppModule } = await imp('dist/app.module.js');
const { configureApp } = await imp('dist/bootstrap.js');
const { loadConfig } = await imp('dist/config.js');
const { AI_ROUTER } = await imp('dist/ai/ai.providers.js');
const { HOSTING_HEALTH_CHECK } = await imp('dist/hosting/hosting.service.js');
const { GATEWAY_FACTORY } = await imp('dist/commerce/gateways.js');
const { SHIPPING_FACTORY } = await imp('dist/commerce/shipping.service.js');
const { BILLING_PROVIDERS } = await imp('dist/billing/billing.service.js');
const { DISCOVERY_FETCH } = await imp('dist/admin/ai-routing.service.js');
const { SERVICES_FETCH } = await imp('dist/appdata/app-services.service.js');
const { ProviderRouter } = await imp('node_modules/@mya/ai/dist/index.js');
const { RazorpayGateway, RazorpayBilling } = await imp('node_modules/@mya/payments/dist/index.js');
const { ShiprocketProvider } = await imp('node_modules/@mya/shipping/dist/index.js');

const env = process.env;
const port = env.BOTS_API_PORT ?? '4100';
const crawlerPort = Number(port) + 1;
await startCrawlerStandIn(crawlerPort);
const router = new ProviderRouter([scriptedProvider, freeGroq], ['fast', 'balanced', 'deep'].map((tier) => ({ provider: 'scripted', model: `bot-sim-${tier}`, tier, priority: 1, inputCostPerMTokMicros: 2_000_000, outputCostPerMTokMicros: 10_000_000, enabled: true })));
const config = loadConfig({
  PATH: env.PATH, NODE_ENV: 'development',
  DATABASE_URL: env.BOTS_DATABASE_URL, SUPABASE_URL: `http://localhost:${env.BOTS_AUTH_PORT}`, SUPABASE_JWT_SECRET: env.BOTS_JWT_SECRET,
  STORAGE_DIR: env.BOTS_STORAGE_DIR, SANDBOX_PROVIDER: 'none', API_PORT: port, ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
  PLATFORM_OWNER_EMAILS: env.BOTS_OWNER_EMAIL, REPORTING_USD_INR: '85', WEB_APP_URL: env.BOTS_WEB_URL, WEB_ORIGIN: [env.BOTS_WEB_URL, env.BOTS_PHONE_URL].filter(Boolean).join(','), PUBLIC_API_URL: `http://localhost:${port}`, HOSTING_PROVIDER: 'fake',
  WEATHER_CONTACT: 'bots@example.com', GROQ_API_KEY: 'bots-groq-key',
  // Website reader stand-in (same contract as services/crawler). Test addresses don't resolve publicly, so the address check is relaxed here only.
  CRAWLER_URL: `http://127.0.0.1:${crawlerPort}`, CRAWLER_TOKEN: TEST.crawlerToken, SITE_IMPORT_ALLOW_PRIVATE_NETWORKS: 'true',
  // Every simulated customer comes from this one machine, so per-address limits are lifted; limits are tested in the API suite.
  APP_DATA_RATE_LIMIT_PER_MINUTE: '100000', APP_AUTH_RATE_LIMIT_PER_MINUTE: '100000', RATE_LIMIT_PER_MINUTE: '100000',
  CHECKOUT_RATE_LIMIT_PER_MINUTE: '100000', GENERATION_RATE_LIMIT_PER_MINUTE: '100000', DEPLOY_RATE_LIMIT_PER_MINUTE: '100000', BILLING_RATE_LIMIT_PER_MINUTE: '100000',
});
const providers = [
  { provide: AI_ROUTER, useValue: router },
  { provide: DISCOVERY_FETCH, useValue: discoveryFetch },
  { provide: SERVICES_FETCH, useValue: servicesFetch },
  { provide: GATEWAY_FACTORY, useValue: (c) => new RazorpayGateway(c, storeRazorpayFetch) },
  { provide: SHIPPING_FACTORY, useValue: (c) => new ShiprocketProvider(c, shiprocketFetch) },
  { provide: BILLING_PROVIDERS, useValue: { razorpay: new RazorpayBilling(TEST.platformRazorpay, platformBillingFetch) } },
  { provide: HOSTING_HEALTH_CHECK, useValue: async () => ({ ok: true, status: 200 }) },
];
const app = await NestFactory.create(AppModule.forRoot(config, providers), { logger: ['error', 'warn'], rawBody: true });
configureApp(app, config);
await app.listen(Number(port));
console.log(`bots api :${port}`);
