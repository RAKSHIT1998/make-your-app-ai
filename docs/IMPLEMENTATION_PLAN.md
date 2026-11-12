# Implementation Plan

Every phase ends with the app running, the relevant tests executed, errors fixed and docs and DEVELOPMENT_STATUS.md updated. A capability is marked done only after its tests have actually run and passed.

## Phase 1 — Foundation
- [ ] Monorepo (pnpm, turbo, shared tsconfig/eslint)
- [ ] Design tokens + ui-web + ui-native starter components
- [ ] NestJS API: config validation, health, structured logging, error filter
- [ ] Prisma schema (all core models), first migration, RLS policies
- [ ] Supabase JWT auth guard, user upsert, personal org bootstrap
- [ ] Organizations + memberships + role checks
- [ ] Projects CRUD with ownership checks + audit log
- [ ] Web shell: auth, Home, Create, Projects, Settings
- [ ] Mobile shell: auth, tab navigation, Home, Create, Projects
- [ ] Tests: API unit + e2e (auth, authz, projects), web component tests

## Phase 2 — AI engine
- [ ] `AiProvider` interface, Anthropic adapter, router (complexity routing, retries, fallback, budget enforcement)
- [ ] Usage + cost tracking, credit ledger debits
- [ ] Agent contracts (zod) for all 6 agents + orchestrator
- [ ] Sandbox interface + Docker dev adapter (limits, timeouts, no-network mode)
- [ ] Per-project git storage + ProjectVersion
- [ ] **End-to-end basic generation: prompt → spec → files → build check → commit → version**
- [ ] OpenAI + Gemini adapters

## Phase 3 — Generation products
- [ ] Next.js website template + generator
- [ ] Expo app template + generator
- [ ] NestJS/Prisma backend template + full-stack generator
- [ ] Edit-by-chat with minimal patches; undo/redo via versions
- [ ] Live preview (sandbox preview server + proxied URL)
- [ ] Workspace UI: chat, preview, file explorer, versions, logs

## Phase 4 — Commerce
- [ ] Commerce engine modules (catalog, variants, inventory, cart, checkout, orders, discounts, tax, shipping)
- [ ] Store template + store admin template
- [ ] Razorpay + Stripe adapters with verified webhooks
- [ ] Business website builder sections

## Phase 5 — Hosting & mobile release
- [ ] Hosting adapter (Vercel/Cloudflare), deployments, health-check verification, rollback
- [ ] Custom domains, DNS instructions, SSL status
- [ ] EAS build integration, build profiles, artifacts
- [ ] Customer-controlled iOS / Google Play release prep (metadata, privacy, instructions)

## Phase 6 — Business & ops
- [ ] Plans/pricing editable by admins, subscriptions, invoices, refunds
- [ ] Credit packages, metering, limits with explicit authorization
- [ ] Admin console (separately authorized API)
- [ ] Analytics, abuse detection, security audit, backup/restore drills
