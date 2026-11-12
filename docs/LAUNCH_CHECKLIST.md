# Launch checklist

Tick these in order. Items marked **(you)** need accounts, decisions or legal sign-off that can't be done in code.

## 1. Accounts and secrets (you)
- [ ] Domain bought; DNS for `<domain>` (web) and `api.<domain>` (API)
- [ ] Supabase project (Auth email templates and Site URL set; Google OAuth client added if you want Google sign-in)
- [ ] Anthropic API key with billing and rate limits sized for launch
- [ ] `ENCRYPTION_KEY` generated (`openssl rand -base64 32`) and stored in a password manager
- [ ] Razorpay and/or Stripe **live** keys plus webhook secrets (KYC/activation done)
- [ ] Vercel token (and team id) for one-click hosting, or leave hosting off
- [ ] `PLATFORM_OWNER_EMAILS` set to your admin email(s)
- [ ] Expo account and Apple Developer / Google Play Console accounts (for mobile)

## 2. Legal (you)
- [ ] `NEXT_PUBLIC_LEGAL_COMPANY`, `_ADDRESS`, `_EMAIL`, `_GRIEVANCE_OFFICER`, `_JURISDICTION`, `_REFUND_DAYS` set; the policy pages no longer show the draft banner
- [ ] A lawyer has reviewed Terms, Privacy, Refunds and Acceptable Use, especially the refund commitment and the AI-output wording
- [ ] Razorpay/Stripe merchant profiles link to the live policy URLs (`/legal/terms`, `/legal/privacy`, `/legal/refunds`)

## 3. Deploy
- [ ] Render Blueprint from `infra/render.yaml`, with every secret filled in
- [ ] First deploy green: `GET https://api.<domain>/api/v1/health` → `{"status":"ok","db":"ok"}`
- [ ] Web shows the landing page at `https://<domain>`; `/robots.txt`, `/sitemap.xml` and `/opengraph-image` load
- [ ] Platform billing webhooks registered (see DEPLOYMENT → Billing webhooks); send a test event from each provider and confirm a 200
- [ ] Admin → Plans: prices and credit allowances reviewed and the plans you sell are active. With Stripe, paste each recurring `price_…` id (Razorpay plans are created automatically on first checkout)
- [ ] Admin → Feature flags: decide what's on at launch (e.g. leave `hosting` off until the Vercel token is set)

## 4. Smoke test in production (real accounts)
- [ ] Sign up, confirm email, sign in on web and mobile
- [ ] Create a website and an app; the generation finishes and the preview renders
- [ ] Buy the cheapest plan with a real card and see the plan and credits arrive (webhook-driven). Then refund it in the provider dashboard: the invoice shows the refund and, for a top-up, the unspent credits are clawed back. Cancel the subscription separately (a refund alone never changes the plan)
- [ ] Publish a project to Explore; open the public page logged out; remix it from a second account
- [ ] Deploy a project to hosting (if enabled) and open the live URL
- [ ] Download a project ZIP; export the App Studio project and run it with `npx expo start`
- [ ] Report a public project from account B, then hide it as admin

## 5. Monitoring and safety nets
- [ ] Uptime monitor on `/api/v1/health` and the landing page (e.g. Better Stack / UptimeRobot)
- [ ] Render notifications for failed deploys
- [ ] Supabase backups enabled; one restore tested
- [ ] Spending limits set at Anthropic and Vercel
- [ ] Read `docs/RUNBOOK.md`; you know where the flag switches are

## 6. Mobile (when ready)
- [ ] `eas init`, then `eas env:create` for `EXPO_PUBLIC_*`
- [ ] `eas build --profile preview` installed on real devices
- [ ] Store listings: screenshots, description, privacy policy URL, support URL, data-safety / privacy-nutrition answers
- [ ] `eas build --profile production` → `eas submit` → TestFlight / Play internal testing → submit for review (approval is up to Apple/Google)

## Known limits at launch
- Run one API instance on Render (single persistent disk). Replicating needs `RATE_LIMIT_STORE=postgres` plus a shared `STORAGE_DIR`; see RUNBOOK → Scaling.
- On Render, generated code gets static checks (`SANDBOX_PROVIDER=none`). Full install/build checks need a host with Docker (`SANDBOX_PROVIDER=docker`).
- Refunds of platform payments are issued in the Razorpay/Stripe dashboard and synced back by webhook (invoice refund status; unspent credits from a refunded top-up are clawed back). A refund never cancels a subscription; cancel it in the provider or in Billing.
- Native mobile builds of *generated* apps are exported as Expo projects for the user to build. The platform does not submit them to stores.
