# Launch plan: going public at the lowest sensible cost

_Researched 2026-11-21. Prices and free tiers change often; check each provider's page before paying._

## 1. Urgent: the live database expires on 14 December 2026

The live database (`mya-db`) is on Render's **free** Postgres plan. Render deletes free databases: they expire
30 days after creation and are deleted 14 days later. Ours was created on 14 November, so it **stops working on
14 December** and is **deleted around 28 December**.

Move it before then. Two options:

| Option | Cost | Notes |
|---|---|---|
| **Move to Supabase Postgres (recommended)** | $0 to start | We already use Supabase for sign-in. Free plan: 500 MB database, 50,000 monthly active users. Free projects pause after 7 days with no activity; real traffic keeps them awake. Upgrade to Pro ($25/month) for daily backups and no pausing once there is revenue. |
| Upgrade the Render database | about $6–7/month (Basic 256 MB) | Nothing to move. One more bill. |

How to move to Supabase (about 15 minutes):
1. Supabase dashboard → your project → **Connect**. Copy the **Session pooler** string (port 5432) and the **Transaction pooler** string (port 6543).
2. On your computer: `SOURCE_URL='<Render external URL>' TARGET_URL='<session pooler URL>' sh scripts/move-database.sh`
   (needs Postgres 18 tools, or use the Docker line at the top of the script). It refuses to overwrite a database that already has our tables, and checks the row counts at the end.
3. Render → `mya-api` → Environment: set `DATABASE_URL` to the transaction pooler URL and `DIRECT_URL` to the session pooler URL. Save; Render redeploys.
4. Open `https://mya-api.onrender.com/api/v1/health` and check `"db":"ok"`, then sign in on the site and open a project.
5. Only then delete `mya-db` in Render.

Our tables have row-level security switched on with no policies, so Supabase's public data API can't read them: only the API server (which connects as the database owner) can.

## 2. Already fixed: customer code no longer depends on a disk

The live API runs on Render's free plan, which has **no persistent disk**. Until this release, generated project
files lived only on the server's disk, so a redeploy or restart could lose them. Every saved version is now also
stored in the database (`ProjectRepo`, a git bundle per project), and the disk is just a cache that refills itself.
Projects built before this release on the live site may already have lost their files; their history in the
database is intact, and rebuilding them restores the files.

## 3. What to run, and what it costs

| | **$0 soft launch** | **Recommended public launch** | Later, with revenue |
|---|---|---|---|
| API (NestJS) | Render Free (sleeps after 15 min idle; ~1 min to wake) | **Render Starter $7/month**, always on | Render Standard $25 (2 GB) when builds need memory |
| Website (Next.js) | Render Free (sleeps) | **Render Starter $7/month** | same |
| Database + sign-in | Supabase Free | **Supabase Free** | **Supabase Pro $25/month** (backups, no pause) |
| Sign-in emails (SMTP) | **Brevo free: 300 emails/day** | Brevo free, or Resend free (100/day) | Brevo Starter $9 or Resend Pro $20 |
| Domain | — | about ₹800–1,200 a year | same |
| AI | free tiers only (rate-limited) | free tiers for quick steps + cheap paid model for building + Claude for Premium AI (customers pay) | same, more paid volume |
| **Fixed monthly cost** | **$0** | **about $14** | **about $40–70** |

Why not other hosts:
- **Two always-on services on Render's free plan don't fit**: a workspace gets 750 free instance hours a month, and two services running all month need about 1,440.
- **Vercel's free Hobby plan is for non-commercial use**, so the website can't live there while selling plans.
- **Railway** has no lasting free plan (a $5/month minimum). **Fly.io** no longer gives new organisations an ongoing free allowance.
- **Oracle Cloud Always Free** gives a real server (now 2 Arm cores, 12 GB RAM) for $0, enough to run everything with `infra/docker-compose.yml`, including the Docker sandbox and the website reader. The catches: you look after the server yourself (updates, backups, TLS), free capacity is often unavailable in popular regions, and Oracle halved the allowance in 2026 without much warning. Good as a cheap second home, risky as the only one.

### Sign-in emails are a launch blocker
Supabase's built-in email sender is for testing only: it sends a handful of emails per hour and only to your own
team's addresses. Without your own SMTP, **new customers can't confirm their accounts or reset passwords.**
Set up Brevo (free, 300/day) or Resend, verify your domain with them, then Supabase → Authentication → Emails →
SMTP Settings. Afterwards raise Supabase's "emails per hour" limit (Authentication → Rate Limits) to suit a launch.
Also add `https://<your-site>/reset-password` under Authentication → URL Configuration → Redirect URLs.

## 4. Spending as little as possible on AI

The router already sends each step to the cheapest route that is good enough and stays up, while customers pay
the same credits whichever route serves them. Suggested routes:

| Tier (what it does) | Route | Cost |
|---|---|---|
| **Fast** (asking, checks, small edits) | Groq free (e.g. gpt-oss-120b: about 1,000 requests and 200k tokens a day), Gemini free Flash-Lite | $0 within limits |
| **Balanced** (normal builds) | a cheap paid model: DeepSeek V4 class (around $0.14 / $0.28 per million tokens) or Gemini Flash-Lite paid | cents per build |
| **Deep** (Premium AI, hardest builds) | Claude via `ANTHROPIC_API_KEY` | only when a customer has Premium AI on and pays for it |

Notes:
- Free tiers are rate-limited and change without notice; keep a paid route on every tier as the fallback.
- **Gemini's free tier may use prompts to improve Google's products**: mention it in the privacy policy or use the paid tier for customer builds.
- **Mistral's free mode trains on requests** and its API is now for business customers under commercial terms; leave it as a paid option only.
- Owner console → AI routing → Free AI providers adds discovered free models in one click and tests each with one real call.

## 5. Checklist to go public

Already done in the product: password reset (web and phone), account deletion, security sweep of every API route,
accessibility checks, durable storage of customer code, load test, 23 product bots (44 runs across desktop and phone).

Still needed from you:
1. **Move the database before 14 December** (section 1).
2. **Fix GitHub billing**: every CI and live-check run since 15 November was refused with "account is locked due to a billing issue", so nothing is being checked automatically.
3. **Custom SMTP for sign-in emails** (section 3) and the reset-password redirect URL.
4. `PLATFORM_OWNER_EMAILS` = your email, so your account opens the owner console.
5. `SUPABASE_SERVICE_ROLE_KEY` on the API, so account deletion also removes the sign-in.
6. AI keys: at least one free fast route (Groq or Gemini), one paid balanced route, and `ANTHROPIC_API_KEY` for Premium AI.
7. Payments: Razorpay (and Stripe for USD) live keys and webhook secrets, then one real ₹1 test.
8. Legal details (`NEXT_PUBLIC_LEGAL_*`) and a lawyer's read of the terms, privacy and refund pages.
9. Upgrade `mya-api` and `mya-web` to Starter so they don't sleep, and add your domain.
10. Phone apps: Expo account, Apple Developer ($99/year), Google Play ($25 once), then EAS builds.

Sources: Render free tier and pricing docs (render.com/docs/free, render.com/pricing); Supabase pricing and
production checklist (supabase.com/pricing, supabase.com/docs/guides/deployment/going-into-prod); Oracle Always
Free documentation; Groq and Gemini rate-limit pages; Brevo and Resend pricing pages; Mistral help centre.
