# Product bots

Each bot uses one product the way a customer would, in a real browser, on a desktop and a phone screen. Bots click
the real web app, talk to the real API and database, and check the results. Nothing is mocked inside the platform.
Only the outside services are stand-ins, so a run is free and charges nothing:

- **AI:** a scripted model that returns realistic projects.
- **Payments:** Razorpay and Stripe emulators. Webhooks are signed exactly as the real services sign them.
- **Delivery:** a Shiprocket emulator.
- **Hosting:** a stand-in host.
- **Website reader:** a stand-in with the same contract as `services/crawler`.
- **Sign-in:** a stand-in for Supabase auth.

```
pnpm build                          # once, after code changes
pnpm bots                           # every bot, desktop + phone (about 2½ minutes)
pnpm bots --only online-store,game  # some bots
pnpm bots --device phone            # one screen size
pnpm bots --list                    # what each bot covers
```

**Needs:**
- Postgres at `BOTS_ADMIN_DATABASE_URL` (default `postgresql://postgres:postgres@localhost:5432/postgres`). The bots
  create and drop their own database, `mya_bots`.
- Chrome or Chromium: Playwright's own (`pnpm --filter @mya/bots exec playwright install chromium`), or set
  `BOTS_CHROME=/path/to/chrome`.

**Ports:** web 3100, API 4100, auth 54400. Change them with `BOTS_WEB_PORT`, `BOTS_API_PORT` and `BOTS_AUTH_PORT`.

**Report:** `tools/bots/report/report.md` lists every step with its time. When a bot fails, the report names the
step that stopped it, the error, and any page errors or server 5xx seen on the way. Screenshots are in
`report/shots`. Server logs are in `report/logs`. CI runs every bot on each push and keeps the report as an artifact.

| Bot | Product |
|---|---|
| website | Websites (Next.js): build, code, edit by chat, versions and restore, health, download |
| business-website | Business websites: publish, Explore, public page, share image |
| game | Games: play in the sandbox, isolation probe, Ask mode, public play |
| web-app | Web apps (browser tools) |
| fullstack-app | Full-stack apps: accounts, data, rules, preview vs live |
| business-kits | Business software kits and team-only apps |
| online-store | Online stores: AI shop front, hosted checkout, webhook-confirmed orders |
| business-studio | Business Studio: products, stock, payments, orders, refunds, Shiprocket |
| mobile-app | Mobile apps (App Studio) |
| idea-check | Idea check |
| owner-dashboard | Per-project owner Dashboard |
| billing | Plans, subscriptions, top-ups, cancel |
| community | Explore, invites, likes, comments, collections, follows, remix |
| team | Team workspaces and invitations |
| cloud-studio | Cloud Studio deploys and the template gallery |
| owner-console | Platform owner console |
| site-import | Start from your current website (stand-in website reader) |

**Writing a bot:** add `products/<name>.mjs` exporting `meta` (`name`, `product`, `covers`) and `run(bot)`. Use
`bot.step()` for each thing a customer does. Wait for what a person would wait for, such as a loaded list or a faded
notification, not a fixed delay.

All bots share one platform and run side by side. A bot that changes something platform-wide (for example a
feature flag) must use a switch no other bot depends on, and must put it back.
