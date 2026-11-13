# Feature Implementation Checklist — "Viral AI Software-Building Ecosystem" spec

_Audit date: 2026-11-13 (sessions 7–10). Audited against the code on `main`, not against intentions. Items marked "(this session)" were implemented and tested in session 7._
Legend: ✅ complete (UI + API + DB + permissions + validation + tests) · 🟡 partial · ⛔ blocked (needs credentials/infrastructure) · ⬜ not started

## Architecture audit (spec §1)
| Area | What exists |
|---|---|
| Frontend | Next.js 16 web app (App Router, Tailwind v4, design system v2), Expo mobile app (older UI) |
| Backend | NestJS 12 API `/api/v1`, zod validation on every body/query, ThrottlerGuard, audit log |
| Database | Postgres 16 + Prisma 7, RLS (deny-by-default for direct clients), 7 migrations |
| Auth | Supabase JWT (JWKS or HS256), personal workspace per user, org roles owner/admin/member/viewer, platform roles user/support/admin/superadmin |
| AI | Provider adapters behind `ProviderRouter` (Anthropic implemented; tiers fast/balanced/deep; admin-editable routes in `AiProviderConfig`); orchestrator architect → designer → frontend → QA repair; per-run credit caps |
| Payments | Platform billing: Razorpay + Stripe adapters, verified webhooks only. Merchant payments: Razorpay + Stripe gateways per store |
| Codegen | Git-backed project store, patch validation, static checks, approvals for destructive changes |
| Sandbox | Provider interface with Docker + local implementations; never runs inside the API process |
| Hosting/deploy | `@mya/hosting` provider adapters (Vercel implemented, fake for dev); deployments, rollback, env vars, domains (session 8) |
| Known limitations | Generation executes in the accepting instance (lease-based recovery; shared rate limits via Postgres); no live preview; only website/business_website generation |

## §2 Viral growth engine
| Item | Status | Notes |
|---|---|---|
| Public project pages, title/description, category, creator, likes, views | ✅ | `/p/:slug`, frozen published snapshot |
| Screenshots and live previews | ⛔ | Needs sandbox/hosting to render; palette preview shown, labelled "soon" |
| Search, filters, trending, recent, featured | ✅ | |
| Shareable links, public/private controls | ✅ | |
| Remix with AI + lineage + attribution, no secrets | ✅ | Published version only; secret-like files stripped |
| Social metadata + OG images; share to WhatsApp/LinkedIn/X/Instagram | ✅ | Instagram via native share/copy (no web intent exists) |
| "Made with" attribution; paid plans can hide | 🟡 | Enforced on public pages; injection into deployed sites waits for hosting |
| Referral programme (codes, URL, dashboard, tracking, conversion, rewards, history, limits, anti-abuse, admin config) | ✅ | Rewards only after verified first payment |
| Weekly challenges, voting, submissions, leaderboards | ⬜ | Phase 3 remaining |
| Comments, follows, collections | ✅ | Threaded comments with per-creator toggle, report → auto-hide at 3 + admin queue, follow + Following feed, public collections; behind the `comments` flag |
| Achievement badges | ✅ (this session) | Computed from real activity |
| Moderation, reporting, spam protection | ✅ | Reports, auto-hide after 3, owner moderation, rate limits |

## §3 AI building experience
| Item | Status | Notes |
|---|---|---|
| Natural-language project creation | ✅ | |
| Clarifying questions + project plan before build | ✅ (this session) | Plan-first mode (default on): architect drafts spec + ≤5 questions + assumptions, metered; user answers (optional), revises by chat, or builds. Building from an approved plan skips re-planning; answers trigger a targeted revision. Only for projects without code; plans can't be used across projects |
| Generate frontend | ✅ | Next.js websites |
| Generate backend, database models, auth, integrations | ⛔ | Needs backend agent + sandbox runtime to verify |
| Run project, working preview | 🟡 | Games and browser apps (static HTML/JS) run in a sandboxed Preview tab today. Next.js sites and Expo apps still need a Docker host / hosting |
| Test workflows | ⛔ | Needs Docker host |
| Incremental edits | ✅ | Patch-based edits, versioned |
| Screenshot-to-app | ⛔ | Needs object storage (R2) + vision-capable key |
| Voice-to-app (voice-to-text, spoken edits, confirmation) | ✅ (this session) | Browser speech recognition in Create and workspace chat; dictation only fills text — generation still needs Generate + confirmation. Hidden when unsupported or switched off. Server-side transcription (Whisper-style) not added |
| Visual editor | ⛔ | Needs live preview |
| Design variations ×3 | ⛔ | Needs preview to compare meaningfully |
| Specialised agents: planning, UI/UX, frontend, QA | ✅ | Real agent runs with events |
| Backend, database, API integration, security review, performance, deployment agents | ⬜/⛔ | Static security checks exist in codegen validation; full agents need sandbox |
| Task tracking, retries, timeouts, cost limits | 🟡 | Retries + per-run/daily cost caps + events exist; durable queue & cancellation UI pending (Inngest) |

## §4 Business software generation
| Item | Status | Notes |
|---|---|---|
| E-commerce stores | 🟡 | Full commerce engine + Business Studio (real orders/payments); storefront generator not yet |
| Games (HTML5) and browser-only apps (calculators, planners, trackers) | ✅ (session 11) | `game` / Web app types, `web-play@1`, validated, repaired, previewed in a sandbox. No backend or accounts |
| CRM, ERP, HR, inventory, restaurant, hotel, booking, marketplace, LMS, membership, SaaS, portals, dashboards, PM, finance | ⛔ | Need full-stack generation + sandbox; templates not started |

## §5 Explore & template marketplace
| Item | Status | Notes |
|---|---|---|
| Trending, new, popular, by type, featured | ✅ | Sorts + type/category filters |
| Popular this week as a named section; creator collections | 🟡 / ✅ | Trending = 7-day window; public collections done |
| Template gallery: submit published project → owner approval → listed; search, category, popular/new/featured; use (clone) without exposing later edits | ✅ (session 8) | Frozen to the published version; secrets stripped; owner review queue |
| Paid templates, reviews/ratings, purchase flow, creator earnings, commission, refunds | ⬜ | Needs creator payouts (Razorpay Route / Stripe Connect) |

## §6 Retention
| Item | Status | Notes |
|---|---|---|
| Build streaks | ✅ (this session) | Consecutive days with a successful AI build/edit; 30-day strip on Home |
| First project / first published / first customer / launch badges | ✅ (this session) | 9 badges computed on read from real records (projects, runs, publishes, likes, remixes, stores, paid orders, rewarded referrals, 7-day streak) — nothing stored, so nothing can be faked |
| Version history + one-click rollback | ✅ | Restore creates a new version |
| Build activity timeline | ✅ (this session) | Workspace timeline from the audit log (whitelisted actions) + run status; tenant-scoped |
| Project health score | ✅ | Health tab: 0–100 score from a static review of the project's latest files (SEO, accessibility, performance, security, mobile config), each finding naming its files and a fix. Says it is not a live measurement |
| AI recommendations, roadmap, weekly report | ⬜ | Next |

## §7 AI business intelligence
| Item | Status |
|---|---|
| Idea validator | ✅ | Idea check page: credit-metered AI assessment (verdict, risks, MVP scope, build brief), saved per workspace, hands the brief to Create. Labelled as general-knowledge judgement, no market data |
| SEO checks, security checks | ✅ | Part of the Health audit (secret scan, client-side secret use, raw HTML/eval) |
| Business-in-a-Box, bug fixer, integration finder | ⬜ (bug fixer partially exists as QA repair loop) |

## §8 AI business agent (post-launch)
| Item | Status | Notes |
|---|---|---|
| Analyse orders, low stock, sales reports from store data | 🟡 | Real analytics exist in Business Studio; conversational agent with permissioned tools not started |

## §9 Team collaboration
| Item | Status | Notes |
|---|---|---|
| Workspaces, roles (server-enforced) | ✅ | Team workspaces created from the Team page, plan-limited; owner/admin/member/viewer enforced on the server; workspace switcher scopes projects, credits, billing, hosting, stores, templates |
| Invitations | ✅ | Single-use link tied to the invited email (hash stored, shown once), seat-checked against the workspace plan, revoke, role change, remove, leave. Email delivery is not wired: the admin copies the link and sends it themselves |
| Shared AI conversations, multiplayer editing, task assignment, agency client workspaces | ⬜ | Phase 4 |

## §10 Cloud Studio
| Item | Status | Notes |
|---|---|---|
| Provider-adapter architecture | ✅ (session 8) | `HostingProvider` interface; Vercel adapter (REST, tested against emulated API); fake provider for dev/tests only |
| Website deployments, status, build logs, history | ✅ (session 8) | Exact version files; restart-safe status sync; "live" only after a real HTTP health check |
| Rollbacks | ✅ (session 8) | Redeploys an earlier version as a new deployment; failed builds never replace the live site |
| Environment variables | ✅ (session 8) | AES-256-GCM, write-only, admin role, synced to provider; NEXT_PUBLIC_ warning |
| Custom domains + SSL | ✅ (session 8) | Pro+; DNS records from provider; SSL reported only when provider confirms |
| Plan gating, daily cap, rate limit, kill switch, audit | ✅ (session 8) | Creator deploys, Pro domains |
| Going live | ⛔ | Needs your `VERCEL_TOKEN` (+ optional `VERCEL_TEAM_ID`) and `HOSTING_PROVIDER=vercel` |
| Backend deployments, hosting analytics, bandwidth/storage usage, error monitoring | ⬜ | Bandwidth/analytics via provider usage APIs next; backends need full-stack generation |

## §11 Mobile Build Studio
| Item | Status | Notes |
|---|---|---|
| Expo / React Native generation | ✅ (session 8) | `expo-app@1` template (SDK 58, Expo Router); mobile_app generation enabled for plans that include it (Pro/Studio by default) |
| App metadata (name, version, bundle ids, colours, privacy URL) | ✅ (session 8) | Written to app.json as a new version (no AI); build numbers bump with version |
| Release checklist | ✅ (session 8) | Computed from app.json; honest blocked/manual items |
| Source download (.zip) | ✅ (session 8) | Any project; secrets stripped; audited |
| Icons & splash images | ⛔ | Colours set; image upload needs R2 storage |
| EAS builds, build logs, artifacts, test builds | ⛔ | Needs `EXPO_TOKEN` + build runner (eas-cli in sandbox); customers can run `eas build` on the download today |
| Customer Apple/Google account submission flows | ⬜ | Customer-controlled; never auto-published |

## §12 Monetization
| Item | Status |
|---|---|
| Free/Creator/Pro/Studio, admin-configurable prices & limits | ✅ |
| Monthly + annual, upgrades, downgrades, cancellation | ✅ (no proration) |
| Payment history, invoices, top-ups, wallet, ledger, metering, webhooks, entitlement checks | ✅ |
| Live payment acceptance | ⛔ needs your live Razorpay/Stripe keys |

## §13 Cost control
| Item | Status | Notes |
|---|---|---|
| AI tokens, model cost, payment fees, revenue, gross margin | ✅ | Owner console |
| Sandbox compute, build minutes, storage, bandwidth | ⛔ | Metered when those services exist |
| Per-user/per-run/daily limits, rate limits, confirmations | ✅ | |
| Per-project limits, concurrency limits | 🟡 | One active run per project enforced; per-project budget not yet |
| Usage alerts, admin credit pricing | 🟡 / ✅ | Credit packs configurable; alerts not yet |
| Unlimited usage never promised | ✅ | |
| Multi-provider AI routing with free/cheap routes, customer billed at the standard tier rate, margin-first selection, quality floors, daily caps, circuit breaker, per-route margin | ✅ | Owner console → AI routing. Needs provider keys + route data from you; adapter not yet run against live providers |

## §14 Owner admin
| Item | Status |
|---|---|
| Users, MRR/ARR, revenue, AI cost, margin, subscriptions, plans, credits, audit log, moderation, referrals | ✅ |
| AI routing console (tier rates, routes, health, margin; audited) | ✅ |
| Feature flags (kill switches) | ✅ (this session) | platform flags (ai_generation, plan_first_builder, voice_input, publishing, explore, remix, referrals, templates, hosting, team_workspaces, comments), enforced by the API (503 `feature_disabled`), audited, owner console tab |
| Churn, conversion, ARPU, model distribution, cost per project, completion time, deployment rate, template approvals, fraud signals, system health | 🟡 partial / ⬜ |

## §15 Onboarding
| Item | Status | Notes |
|---|---|---|
| Prompt, voice, explore entry points | ✅ (voice this session) | |
| Screenshot upload, template start | ⛔ / ⬜ | storage; templates |
| After generation: publish, share, remix settings | ✅ | Share panel in workspace |
| Working preview, deployment options | ⛔ | hosting |

## §16–17 Design & security
Design system v2 ✅ · AI adapters ✅ · sandbox isolation ✅ (no generated code in API) · validation ✅ · tenant isolation ✅ (tests) · audit logs ✅ · rate limits ✅ · migrations ✅ · background jobs 🟡 (in-process) · observability 🟡 (logs only; Sentry pending)

## Launch readiness (session 9)
| Item | Status | Notes |
|---|---|---|
| Production config validation, health live/ready, graceful shutdown, run recovery | ✅ | API e2e (`production.e2e.test.ts`) |
| Deploy: Dockerfiles, docker-compose, Render blueprint, CI | ✅ | Bundles verified natively; CI builds the images |
| Security headers (CSP, HSTS, frame, referrer, permissions) | ✅ | Playwright: no CSP violations |
| Landing page, SEO (metadata, robots, sitemap, OG, manifest), 404/error pages | ✅ | |
| Legal details from env + draft banner | ✅ | Needs your company details + counsel review |
| Stripe price ids in Owner console | ✅ | Razorpay plans auto-created |
| Mobile store prep (icons, app.json 1.0.0, eas.json) | ✅ | Needs `eas init` + store accounts |
| Launch checklist, runbook, deployment guide | ✅ | docs/ |
| Error tracking (Sentry) | ⬜ | post-launch (platform refund sync is done) |

## Credentials / infrastructure still needed
Anthropic key (live AI) · Supabase project · live Razorpay + Stripe keys · Docker host for sandbox · hosting provider (Vercel/Cloudflare/Render) · Cloudflare R2 (uploads/screenshots) · Expo EAS token · Inngest + Upstash Redis · Sentry.
