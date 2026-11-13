# Deployment

Everything below is configuration you supply. Nothing is pre-connected, and the API refuses to start in production if a required value is missing or unsafe. It lists every problem at once.

## What ships

| Piece | Artifact | Where |
|---|---|---|
| API (NestJS) | `apps/api/Dockerfile`, a multi-stage image with `git` + `tini` that runs as a non-root user | Render (`infra/render.yaml`) or any Docker host with a persistent disk |
| Migrations | `/migrate` folder inside the API image (Prisma CLI, schema and engine fetched at build time) | Render `preDeployCommand`, or the `migrate` service in `infra/docker-compose.yml` |
| Web (Next.js) | `apps/web/Dockerfile` (standalone output) | Render, or Vercel (root `apps/web`, the framework is detected automatically) |
| Mobile (Expo) | `apps/mobile/app.json` + `eas.json` | EAS Build / EAS Submit |
| Database + Auth | Supabase | supabase.com |
| CI | `.github/workflows/ci.yml` (tests against Postgres 16, typecheck, audit, both Docker images) | GitHub Actions |

## Local development
```bash
pnpm install
cp .env.example .env              # fill in SUPABASE_*, DATABASE_URL, ANTHROPIC_API_KEY
pnpm --filter @mya/db exec prisma migrate deploy
pnpm dev                          # api :4000, web :3000
pnpm --filter @mya/mobile start   # Expo
```
Production-like stack: `docker compose -f infra/docker-compose.yml up --build` runs Postgres, then migrations, then the API and web.

## Production deploy (Render + Supabase)
1. **Supabase:** create a project. Copy the pooled connection string (`DATABASE_URL`), the direct connection string (`DIRECT_URL`), the project URL and anon key, and the JWT secret if the project uses HS256. Under Auth → URL configuration, set the Site URL and add `https://<domain>/home` as a redirect URL (Google sign-in returns there).
2. **Render:** create a Blueprint from this repo, pointing at `infra/render.yaml`. Fill every `sync: false` value in the dashboard (table below).
3. Deploy. Render builds the image, runs `prisma migrate deploy` before the new version starts, and routes traffic only after `GET /api/v1/health` returns `{"status":"ok","db":"ok"}`.
4. Point DNS at the two services: `api.<domain>` → mya-api and `<domain>` → mya-web. Then set `WEB_ORIGIN`, `WEB_APP_URL`, `PUBLIC_API_URL` and `NEXT_PUBLIC_*` to the final https URLs. Web values are baked in at build time, so changing them needs a web redeploy.
5. Register the billing webhooks (below), then work through `docs/LAUNCH_CHECKLIST.md`.

**Health endpoints:** `GET /api/v1/health/live` is process liveness. `GET /api/v1/health` is readiness and includes the database.

## Configuration

### API (required in production)
| Variable | Notes |
|---|---|
| `NODE_ENV=production` | Turns on the production safety checks |
| `DATABASE_URL`, `DIRECT_URL` | Supabase pooled (runtime) / direct (migrations) |
| `SUPABASE_URL` and/or `SUPABASE_JWT_SECRET` | JWT verification (JWKS, or legacy HS256) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts merchant gateway credentials and project env vars. **Back it up; losing it makes that data unreadable.** |
| `WEB_ORIGIN`, `WEB_APP_URL`, `PUBLIC_API_URL` | Public https URLs (CORS, links, webhook URLs shown to merchants) |
| `STORAGE_DIR` | Absolute path on a persistent disk (one git repository per project). On Render: `/data/projects` |
| `ANTHROPIC_API_KEY` | AI generation. Without it (and with no other provider key), generation reports "not configured" |
| `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`, `TOGETHER_API_KEY`, `CEREBRAS_API_KEY`, `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`, `CUSTOM_AI_NAME` / `CUSTOM_AI_BASE_URL` / `CUSTOM_AI_API_KEY` | Optional extra providers for smart routing. Routes are added in Owner console → AI routing; a route without its key is never used |
| `AI_ROUTING_STRATEGY` | `margin` (default: cheapest reliable route that meets the tier's quality floor) or `priority` |
| `PLATFORM_OWNER_EMAILS` | Comma-separated emails that get the platform admin console |
| `TRUST_PROXY` | `1` behind Render/Vercel/one load balancer, so rate limits see the real client IP |

### API (optional / feature-specific)
| Variable | Notes |
|---|---|
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Platform subscriptions and credit packs (India) |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Platform subscriptions and credit packs (international) |
| `HOSTING_PROVIDER=vercel`, `VERCEL_TOKEN`, `VERCEL_TEAM_ID` | One-click hosting. `fake` is refused in production |
| `SANDBOX_PROVIDER` | `none` = static checks only (the Render default: no Docker-in-Docker). `docker` needs a host with a Docker daemon plus `SANDBOX_DOCKER_IMAGE` and `SANDBOX_DOCKER_INSTALL_NETWORK`. `local` is refused in production |
| `CREDITS_PER_USD`, `MAX_CREDITS_PER_RUN`, `FREE_PLAN_CREDITS`, `REPORTING_USD_INR` | Credit pricing and reporting |
| `RATE_LIMIT_PER_MINUTE`, `GENERATION_RATE_LIMIT_PER_MINUTE`, `CHECKOUT_RATE_LIMIT_PER_MINUTE`, `DEPLOY_RATE_LIMIT_PER_MINUTE`, `BILLING_RATE_LIMIT_PER_MINUTE`, `MAX_DEPLOYMENTS_PER_DAY`, `CHECKOUT_RESERVATION_MINUTES` | Abuse controls |
| `RECOVER_INTERRUPTED_RUNS` (default `true`), `RUN_LEASE_SECONDS` (default `60`), `SHUTDOWN_GRACE_SECONDS` (default `25`) | Restart and crash behaviour (see RUNBOOK) |
| `RATE_LIMIT_STORE` (`memory` default, or `postgres`) | `postgres` shares request limits across API instances |

### Web (build-time, public)
`NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the legal details `NEXT_PUBLIC_LEGAL_COMPANY`, `_ADDRESS`, `_EMAIL`, `_GRIEVANCE_OFFICER`, `_JURISDICTION`, `_REFUND_DAYS`. Until every legal value is set, the policy pages show a visible "draft" banner and "[… to be completed]" placeholders.

### Mobile (EAS environment variables)
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Set them per environment with `eas env:create`. A release build without them shows a setup notice; it never silently calls localhost.

## Billing webhooks (platform)
- **Razorpay:** Dashboard → Webhooks → `https://api.<domain>/api/v1/webhooks/billing/razorpay`, with the secret = `RAZORPAY_WEBHOOK_SECRET`. Events: `subscription.activated`, `subscription.charged`, `subscription.pending`, `subscription.halted`, `subscription.cancelled`, `subscription.completed`, `payment.captured`, `order.paid`, `payment.failed`, `refund.processed`.
- **Stripe:** Developers → Webhooks → `https://api.<domain>/api/v1/webhooks/billing/stripe`, then copy the signing secret into `STRIPE_WEBHOOK_SECRET`. Events: `checkout.session.completed`, `invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`.
- Only verified webhooks grant plans or credits. The browser can never change entitlements.

## Merchant payment setup (per store, in Stores → Settings)
- **Razorpay:** API Keys (key id and secret). Webhooks: add the URL shown in Settings, set a secret, and enable `payment.captured`, `order.paid` and `payment.failed`.
- **Stripe:** API keys (publishable and secret). Webhooks: the URL shown in Settings with `payment_intent.succeeded` and `payment_intent.payment_failed`, then the signing secret (`whsec_…`).

## Mobile release
```bash
cd apps/mobile
eas init                    # links the app to your Expo account (adds the projectId)
eas env:create              # EXPO_PUBLIC_* for preview and production
eas build -p all --profile production
eas submit -p ios --profile production       # App Store Connect (TestFlight)
eas submit -p android --profile production   # Play Console, internal track, as a draft
```
Store approval is decided by Apple and Google. Nothing here publishes to the public stores automatically.

## Scaling note
Run **one API instance** on Render (its persistent disk attaches to a single instance). The API itself is safe to replicate; see RUNBOOK → Scaling for what a multi-instance setup needs.
