# Development Status

_Last updated: 2026-11-12, session 4 (spec v3 is the single source of truth)._
_If context is lost: read this file, then IMPLEMENTATION_PLAN.md, and continue from "Next tasks"._

## Current phase
**Phase 2 (Billing & Monetization) is implemented and tested against emulated providers.** Its acceptance test ("a real payment activates the correct subscription") still needs the platform's live Razorpay and Stripe test keys. Phases 1, 3, 5 and 6 are partially complete (see IMPLEMENTATION_PLAN.md).

## Completed (verified)
| Feature | Evidence |
|---|---|
| Auth, workspaces, roles, profiles, owner bootstrap, platform RBAC on `/admin` (404 for customers) | API e2e |
| Billing: plans and prices as data, Razorpay subscriptions and top-ups, Stripe Checkout and billing webhooks, verified + exactly-once + amount-checked activation, renewals with allowance reset, cancel at period end, halt or end → Free (projects kept, over-limit = AI read-only), upgrade cancels the old subscription, invoices | **14 billing/admin e2e tests** using the real request builders and HMAC / Stripe signature verification against emulated provider APIs |
| Credit ledger buckets (allowance expires, purchased never expires, allowance spent first) and plan limits (projects, project types, daily, per run) | billing e2e + 41 existing e2e still green |
| Owner console: MRR/ARR, revenue, fees, AI cost, INR margin, users with per-customer revenue vs AI cost, suspend/restore, credit adjustments, plan editing, audit log | e2e + browser |
| Pricing page, billing page, top-ups, payment history, legal policy **drafts** (terms, privacy, AUP, refunds, subscriptions) | Chrome at 1440px and 390px: pricing → choose Creator → Razorpay modal opens with the platform key → plan unchanged until a signed `subscription.charged` → "Payment confirmed", 480 allowance → top-up via signed `order.paid` → +300 purchased → owner console shows MRR ₹999 → owner edits Creator credits to 600 (verified in DB). No console errors |
| Earlier sessions: AI engine + website generation, commerce engine + merchant dashboard, web and mobile apps | see git history; all tests green |

**Test totals (this run):** api 55, codegen 19, ai 10, agents 8 (+1 sandbox integration), payments 6, web 3, sandbox 1 (+1 integration). Mobile typecheck OK. **0 failing.**

## In progress
None. The session ended at a clean commit.

## Blocked (missing credentials or infrastructure)
| Item | Needs |
|---|---|
| Phase 2 live acceptance (real payment → entitlement) | Platform `RAZORPAY_KEY_ID/SECRET/WEBHOOK_SECRET` (Subscriptions enabled), `STRIPE_SECRET_KEY/WEBHOOK_SECRET`, plus Stripe Price ids saved on plans |
| Live AI generation check | `ANTHROPIC_API_KEY` |
| Real auth | Supabase project keys |
| Docker sandbox run | A host with a Docker daemon |

## Failed tests
None.

## Known issues / limitations
- Pro and Studio advertise features that are not built yet. The pricing page marks them "coming soon". **Recommendation: hide Pro and Studio in the Owner console until App Studio and hosting ship.**
- Plan allowances, yearly prices and credit-pack prices are proposals (BUSINESS_MODEL.md). Validate them with real generation costs.
- No proration. Invoice numbers come from one global sequence (GST may need per-FY numbering and a GSTIN invoice PDF). No dunning emails. No platform refund UI.
- Legal pages are drafts with bracketed company details. They need counsel review.
- Generation, the stock-hold timer and rate limiting run in-process. They need Inngest and Redis before running more than one instance.
- Sandbox compute, storage, hosting and bandwidth costs are not metered yet. Margin reports say so.
- Commerce: no storefront generator, customer accounts, wishlist, reviews, returns or PayPal.
- Mobile app has no billing or owner screens yet (web only).

## Missing credentials (complete list)
Supabase (URL, anon key, DB URLs, JWT secret if legacy) · `ANTHROPIC_API_KEY` · `ENCRYPTION_KEY` · `PLATFORM_OWNER_EMAILS` · platform Razorpay keys and webhook secret · platform Stripe keys and webhook secret · `REPORTING_USD_INR` (optional). Later: Upstash Redis, Inngest, Cloudflare R2, Render, Expo/EAS, Vercel or Cloudflare, Sentry.

## Next tasks (in spec order)
1. With live keys: run the Phase 2 acceptance with a ₹1 test plan, then verify webhooks from the provider dashboards.
2. Phase 3 completion: Inngest durable runs, OpenAI and Gemini adapters, backend agent, Docker sandbox verification.
3. Phase 4 App Studio: Expo template + generator, Expo-web preview.
4. Phase 5: live preview + visual editor.
5. Phase 6: storefront generator on the commerce API.
