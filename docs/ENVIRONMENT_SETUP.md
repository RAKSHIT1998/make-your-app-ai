# Environment Setup

Copy `.env.example` to `.env`. **Never commit `.env`.** Values marked *secret* must only live in the server environment.

| Variable | Where | Required | Purpose |
|---|---|---|---|
| `DATABASE_URL`, `DIRECT_URL` | api, db | yes | Supabase Postgres (pooled / direct) |
| `SUPABASE_URL` | api | yes* | JWKS verification of Supabase tokens |
| `SUPABASE_JWT_SECRET` *secret* | api | legacy projects | HS256 verification |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | web | yes | Sign-in |
| `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_API_URL` | mobile | yes | Sign-in, API |
| `NEXT_PUBLIC_API_URL` | web | yes | API base (the `/api/v1` suffix is added by the client) |
| `ANTHROPIC_API_KEY` *secret* | api | for generation | AI provider |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `CEREBRAS_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CUSTOM_AI_*` *secret* | api | optional | Extra routes for smart routing (see Owner console → AI routing) |
| `WEATHER_CONTACT` | api | optional | Real email or website identifying us to MET Norway for the free weather service. Without it, `WEB_APP_URL` is used if it is a public https address; otherwise weather says it isn't set up |
| `ENCRYPTION_KEY` *secret* | api | for merchant payments | `openssl rand -base64 32`. Encrypts stored integration credentials |
| `PLATFORM_OWNER_EMAILS` | api | yes | Comma list, promoted to superadmin on sign-in |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` *secret*, `RAZORPAY_WEBHOOK_SECRET` *secret* | api | for INR billing | Platform's own Razorpay account (Subscriptions enabled). Webhook URL: `/api/v1/webhooks/billing/razorpay` |
| `STRIPE_SECRET_KEY` *secret*, `STRIPE_WEBHOOK_SECRET` *secret* | api | for non-INR billing | Webhook URL: `/api/v1/webhooks/billing/stripe` |
| `WEB_APP_URL` | api | yes | Checkout return URLs |
| `PUBLIC_API_URL` | api | yes | Shown to merchants as their webhook base |
| `REPORTING_USD_INR` | api | optional | FX rate used only for margin reports |
| `STORAGE_DIR` | api | yes | Persistent disk for project git repos |
| `SANDBOX_PROVIDER` | api | yes | `docker` in production |
| `RATE_LIMIT_PER_MINUTE`, `CHECKOUT_RATE_LIMIT_PER_MINUTE`, `GENERATION_RATE_LIMIT_PER_MINUTE` | api | optional | Abuse controls |
| `CREDITS_PER_USD`, `MAX_CREDITS_PER_RUN`, `FREE_PLAN_CREDITS` | api | optional | Credit economics (plans in the DB override per-plan values) |

## Provider dashboards
- **Razorpay (platform):** enable Subscriptions. Add a webhook for `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed` and `order.paid`.
- **Stripe (platform):** create recurring Prices and paste each `price_…` id on the plan in the Owner console. Add a webhook for `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated` and `customer.subscription.deleted`.
- **Supabase:** Auth → enable Email (and Google if wanted). Set the site URL to your web app.


## Hosting (Cloud Studio)
| Variable | Notes |
|---|---|
| `HOSTING_PROVIDER` | `vercel` in production. `fake` only for local development (rejected when NODE_ENV=production). Default `none` = hosting shows "not connected". |
| `VERCEL_TOKEN` | Platform Vercel access token (Account Settings → Tokens). Server-side only; never sent to browsers. |
| `VERCEL_TEAM_ID` | Optional: deploy into a Vercel team. |
| `MAX_DEPLOYMENTS_PER_DAY` | Per workspace (default 30). |
| `DEPLOY_RATE_LIMIT_PER_MINUTE` | Per client (default 10). |
`ENCRYPTION_KEY` is required for project environment variables.
