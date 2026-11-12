# Make Your App AI — Architecture

> Build Anything. From Anywhere.

## 1. System overview

```
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  Web (Next)  │  │ iOS (Expo)   │  │ Android(Expo)│      Clients
└──────┬───────┘  └──────┬───────┘  └──────┬───────┘
       │  HTTPS + Supabase JWT (Bearer)    │
       ▼                                   ▼
┌─────────────────────────────────────────────────────┐
│                 API  (NestJS, apps/api)             │
│  auth guard · orgs · projects · generation · billing│
│  admin (separate guard) · webhooks · SSE streams    │
└───┬───────────┬───────────┬───────────┬─────────────┘
    │           │           │           │
    ▼           ▼           ▼           ▼
 Postgres     Redis      Inngest     Object storage
 (Supabase,  (rate lim, (durable    (Cloudflare R2:
  Prisma)    locks,     workflows:  artifacts, snapshots)
             cache)     generation,
                        builds, deploys)
                           │
                           ▼
              ┌─────────────────────────┐
              │  Orchestrator (packages/│
              │  agents) — 6 agents      │
              │  with JSON contracts     │
              └────┬───────────────┬────┘
                   ▼               ▼
         AI Provider Router    Sandbox Adapter
         (packages/ai)         (packages/sandbox)
         Anthropic/OpenAI/     isolated containers:
         Gemini adapters       install/build/test/preview
                                   │
                                   ▼
                         Git storage (per-project repo)
                         = source of truth for code
```

## 2. Principles

1. **The API never executes generated code.** All install/build/test/preview runs in a sandbox behind `SandboxProvider`.
2. **Git is the source of truth for project files.** Sandboxes are disposable. Each generation run produces a commit; `ProjectVersion` rows point at commit SHAs.
3. **Vendors behind adapters.** AI models, sandboxes, hosting, payments, mobile builds and email each have an interface in a package plus one or more adapters. Nothing outside the adapter imports a vendor SDK.
4. **Agents return structured JSON, validated with zod.** If an agent returns invalid output, it is retried a bounded number of times and then fails visibly. It is never coerced into passing.
5. **Every customer-owned row carries `organizationId`.** API services check membership, and Postgres RLS enforces the same rule as a second layer.
6. **Money moves through a ledger.** Credits are append-only `CreditLedgerEntry` rows written inside DB transactions with idempotency keys.
7. **Customer approval is required** for publishing, domain changes, payment activation, destructive modifications and paid upgrades. These flows use the `ApprovalRequest` model.

## 3. Monorepo layout

```
make-your-app-ai/
├─ apps/
│  ├─ api/          NestJS 12 API (ESM) + Inngest functions
│  ├─ web/          Next.js (App Router) — dashboard, workspace IDE, admin console
│  └─ mobile/       Expo + Expo Router — mobile-native platform client
├─ packages/
│  ├─ db/           Prisma schema, migrations, client, RLS SQL
│  ├─ shared/       zod schemas + TS types shared by API and clients (API contracts)
│  ├─ design-tokens/ colours, type scale, spacing, radii, motion (web + native)
│  ├─ ui-web/       React + Tailwind component library
│  ├─ ui-native/    React Native component library
│  ├─ ai/           Provider interface, router, Anthropic/OpenAI/Gemini adapters, usage + cost
│  ├─ agents/       Agent contracts (zod), orchestrator, prompts
│  ├─ sandbox/      SandboxProvider interface + Docker (dev) adapter + managed adapter
│  ├─ codegen/      Versioned project templates, file-patch engine, import graph validator
│  └─ config/       tsconfig / eslint / prettier presets
├─ docs/            Engineering docs (this folder)
├─ infra/           docker-compose (dev), render.yaml
└─ turbo.json, pnpm-workspace.yaml
```

## 4. Key flows

### 4.1 Generation run (create or edit)
1. Client `POST /projects/:id/generations` with a prompt. The API checks ownership and the credit budget, creates a `GenerationRun(status=queued)`, emits an Inngest event and returns `runId`.
2. The Inngest function `generation.run` executes durable steps:
   1. **Architect** → `ProductSpec` (zod) persisted.
   2. **Designer** → `DesignSpec`.
   3. **Frontend / Backend** agents → `FilePatch[]`. A patch is a create, update or delete with full content or a unified diff. They are applied to a working tree checked out from git.
   4. **codegen validator**: import graph check (no missing modules, no unresolved relative imports).
   5. **Sandbox**: install, then typecheck, lint, test and build. On failure the **QA agent** receives the logs and returns repair patches. At most N repair loops run.
   6. Commit to the project git repo, then create `ProjectVersion`, then start the preview server.
3. Every step writes `AgentTask` and `AgentEvent` rows, and clients stream them over SSE (`GET /generations/:id/events`).
4. Every AI call writes `AiUsage` rows (tokens and cost) and a `CreditLedgerEntry` debit, inside one transaction.

### 4.2 Edit vs regenerate
Edit runs send the agent the current file tree index (paths, exports, sizes) plus the relevant file contents chosen by retrieval. The agent returns minimal patches. A patch that deletes or rewrites more than a threshold of existing lines is flagged as destructive and requires approval.

### 4.3 Auth
Supabase Auth issues JWTs on the client. The API verifies them with the project's JWKS (asymmetric keys) or the JWT secret (legacy HS256), then upserts the `User` row. On first login it creates a personal `Organization`.

## 5. Technology choices (pinned in package.json)

| Area | Choice |
|---|---|
| Package manager / build | pnpm workspaces + Turborepo |
| API | NestJS 12 (ESM), TypeScript 6 strict, zod 4 validation |
| DB | PostgreSQL 16 via Supabase, Prisma 7 (driver adapter `@prisma/adapter-pg`) |
| Queue/workflows | Inngest (durable steps), Redis (rate limits, locks) |
| Web | Next.js (App Router), React, Tailwind CSS |
| Mobile | Expo SDK + Expo Router, TanStack Query, Zustand |
| AI | Provider router; first adapter: Anthropic Messages API |
| Sandbox | Docker adapter for dev; managed sandbox adapter for prod |
| Storage | Cloudflare R2 (S3 API) |
| Observability | Sentry, OpenTelemetry, pino structured logs |
| Payments | Razorpay + Stripe adapters |
| Mobile builds | Expo EAS |
| Hosting | Render (platform); Vercel/Cloudflare adapters (customer sites) |

Exact versions live in each `package.json`. Dependencies are pinned, and the lockfile is committed.
