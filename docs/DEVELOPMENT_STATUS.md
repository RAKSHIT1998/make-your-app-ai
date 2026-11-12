# Development Status

_Last updated: 2026-11-12, session 2_

## What works today (verified)
A signed-in user can create a **website** or **business website** project on web or mobile and describe it. The AI then plans it (Architect), designs it (Designer), writes it (Frontend), statically validates it, repairs it if needed (QA) and verifies it in a sandbox. The result is saved as a git-backed version. After that the user can ask for changes in chat, browse files, restore earlier versions and approve or discard destructive edits. Every AI call is metered and charged against a credit ledger.

| Area | Evidence |
|---|---|
| AI provider layer: router with retries, fallback, budget checks and cost per call; Anthropic adapter with structured outputs | 10 tests. The adapter's real SDK request and response path is exercised through an injected fetch |
| Agents: zod contracts, schema-validated runner with corrective retry, prompt-injection containment, orchestrator with QA repair loop and destructive-edit approval | 9 tests, including **real `npm install` + `tsc` + `next build` of AI-produced code in the sandbox** (SANDBOX_INTEGRATION=1) |
| Codegen: safe patch engine (path-traversal, .env and .git writes blocked), static import validator, `nextjs-site@1` template, git project store | 19 tests. The template installs, typechecks and builds with Next 16.4.6 |
| Sandbox: local process provider (scrubbed env, command allow-list, prlimit, timeout and process-group kill) | 2 tests |
| API: generation runs, events (JSON + SSE), files, versions/restore, approvals, credits, race-safe provisioning | 19 e2e tests against real Postgres |
| Web app (Next.js 16): login, home, create, projects, workspace (chat, live progress, files, versions, approvals), settings, dark mode | Production build OK, 3 component tests, **full flow driven in Chrome at 1440px and 390px with no console errors** |
| Mobile app (Expo SDK 58): login, tabs (Home, Create, Projects, Settings), workspace (chat, files, versions, approvals) | `tsc` OK, **iOS and Android JS bundles export cleanly**, full flow driven in Chrome via the react-native-web build with no errors |

Bugs caught by these checks and fixed: devDependencies skipped during sandbox install; a race in user, org and credit provisioning on a first page load; a mobile button made invisible by `Link asChild`; authenticated queries firing before login.

## Honest gaps (next sessions)
1. **Live preview.** The sandbox preview server and proxied URL are not built yet.
2. **Durable execution.** Runs execute in-process. They need to move to Inngest steps.
3. **Docker sandbox.** Implemented, but not yet run, because the build environment has no Docker daemon. Production must not use the local sandbox, and config enforces this.
4. **Other project types.** Mobile app, e-commerce, SaaS and custom software are shown as "Coming soon", and the API returns 422 for them. Each needs a template plus the Backend agent.
5. **Not tested against the live Anthropic API.** No key is available in this environment, so the adapter was tested against the SDK with recorded responses. Add `ANTHROPIC_API_KEY` and run one generation to confirm.
6. **Not started:** OpenAI and Gemini adapters, hosting and domains, EAS builds, billing plans and checkout, admin console, Sentry/OTel, and rate limiting with Redis.

## Requires customer configuration
- Supabase: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `DATABASE_URL`, `DIRECT_URL` (plus `SUPABASE_JWT_SECRET` for legacy HS256 projects)
- `ANTHROPIC_API_KEY`
- A persistent disk for `STORAGE_DIR`, and Docker for `SANDBOX_PROVIDER=docker` in production

## Environment notes
- In this build sandbox, Prisma's native engine download is blocked. Set `PRISMA_SCHEMA_ENGINE_BINARY=/bin/false` for `prisma generate` here. Migrations were produced with Prisma's official wasm schema engine. On a normal machine nothing special is needed.
