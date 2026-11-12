# Make Your App AI

**Build Anything. From Anywhere.** An AI software creation platform for mobile apps, websites, e-commerce stores and SaaS.

- Architecture: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Status: [docs/DEVELOPMENT_STATUS.md](docs/DEVELOPMENT_STATUS.md)
- Setup: [docs/ENVIRONMENT_SETUP.md](docs/ENVIRONMENT_SETUP.md), [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
- Business model & billing: [docs/BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md), [docs/BILLING_ARCHITECTURE.md](docs/BILLING_ARCHITECTURE.md)

```bash
pnpm install
cp .env.example .env   # fill in Supabase + Anthropic values
pnpm db:deploy
pnpm build && pnpm --filter @mya/api test
```
