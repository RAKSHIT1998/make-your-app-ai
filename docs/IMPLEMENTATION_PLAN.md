# Implementation Plan (spec v3 order)

Legend: [x] done and tested · [~] partial · [ ] not started

## Phase 0 — Repository audit
- [x] Audit + DEVELOPMENT_STATUS.md

## Phase 1 — Commercial SaaS foundation
- [x] Monorepo, design tokens, responsive web app, Expo mobile app
- [x] Supabase auth, profiles (`PATCH /me`), organizations and roles, projects
- [x] PostgreSQL + Prisma + RLS
- [x] Owner admin authentication (platform roles, owner bootstrap)
- [x] Subscription database structure

## Phase 2 — Billing and monetization
- [x] Pricing page, Free and paid plans (monthly and yearly)
- [x] Razorpay subscriptions and top-ups; Stripe adapter (Checkout Sessions)
- [x] Verified webhooks, subscription lifecycle, credit ledger with buckets, usage limits
- [x] Billing dashboard, owner pricing management, owner overview, customer management
- [~] Live-account verification (needs platform keys) · [ ] proration · [ ] GST invoice PDF · [ ] dunning emails · [ ] platform refunds UI

## Phase 3 — AI development engine
- [x] Anthropic adapter, router, contracts, architect/designer/frontend/QA agents, orchestrator, usage tracking, cost controls
- [~] Isolated execution: local dev sandbox tested; Docker sandbox not yet run
- [ ] OpenAI and Gemini adapters · [ ] backend, database, security and release agents · [ ] Inngest durable runs

## Phase 4 — App Studio
- [ ] Expo project template + generator, screens and navigation, backend, preview (Expo web), versioning

## Phase 5 — Website Studio
- [x] Next.js generation, SEO metadata, sitemap and robots, AI editing, versions
- [ ] Visual editor · [ ] live responsive preview · [ ] forms backend · [ ] analytics integration

## Phase 6 — Business Studio
- [x] Commerce engine: products, inventory, checkout, payments, orders, refunds, discounts, merchant dashboard
- [ ] Storefront generation · [ ] customer accounts, wishlist, reviews · [ ] staff permissions UI · [ ] returns

## Phase 7 — Cloud Studio (HOSTING.md) · Phase 8 — Mobile build & release (PUBLISHING.md)
- [ ] All

## Phase 9 — Owner administration
- [x] Revenue dashboard, users, plans, credits, audit log
- [ ] AI provider controls UI · [ ] infrastructure monitoring · [ ] support management

## Phase 10 — Production hardening
- [ ] Security audit, load tests, backups and restore drill, Sentry and OpenTelemetry, Redis-backed rate limits
