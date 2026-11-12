# Implementation Plan

Every phase ends with the app running, the relevant tests executed, errors fixed and docs and DEVELOPMENT_STATUS.md updated. A capability is marked done only after its tests have actually run and passed.

## Phase 1 — Foundation
- [x] Monorepo (pnpm, turbo, shared tsconfig/eslint)
- [x] Design tokens + web and native UI primitives (in-app; extraction to packages pending)
- [x] NestJS API: config validation, health, error handling (pino structured logging pending)
- [x] Prisma schema (all core models), first migration, RLS policies
- [x] Supabase JWT auth guard, user upsert, personal org bootstrap
- [x] Organizations + memberships + role checks
- [x] Projects CRUD with ownership checks + audit log
- [x] Web shell: auth, Home, Create, Projects, Settings
- [x] Mobile shell: auth, tab navigation, Home, Create, Projects
- [x] Tests: API unit + e2e (auth, authz, projects), web component tests

## Phase 2 — AI engine
- [x] `AiProvider` interface, Anthropic adapter, router (complexity routing, retries, fallback, budget enforcement)
- [x] Usage + cost tracking, credit ledger debits
- [~] Agent contracts + orchestrator: architect, designer, frontend and qa are live; backend and release contracts come with Phase 3–5
- [~] Sandbox interface: local dev adapter tested; Docker adapter written but not yet run (no Docker daemon in the build environment)
- [x] Per-project git storage + ProjectVersion
- [x] **End-to-end basic generation: prompt → spec → files → build check → commit → version**
- [ ] OpenAI + Gemini adapters

## Phase 3 — Generation products
- [x] Next.js website template + generator
- [ ] Expo app template + generator
- [ ] NestJS/Prisma backend template + full-stack generator
- [x] Edit-by-chat with minimal patches; undo/redo via versions
- [ ] Live preview (sandbox preview server + proxied URL)
- [x] Workspace UI: chat, file explorer, versions, run log (live preview pending)

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
