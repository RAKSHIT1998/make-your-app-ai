# Hosting (Cloud Studio) — NOT YET BUILT (Phase 7)

Planned design. The schema already exists: `HostingDeployment`, `Domain`.
- `HostingProvider` adapter interface (deploy, status, rollback, addDomain, verifyDomain, getLogs), with Vercel and Cloudflare adapters implemented against their official APIs.
- A deployment is `live` only after an HTTP health check against the deployed URL passes. Until then it stays `deployed_unverified`.
- Custom domains: show the DNS records to add, poll verification, then report SSL status from the provider.
- Hosting usage (bandwidth, requests) recorded per org for billing (`HostingUsage`, planned).
- Plans gate hosting through feature flags `hosting_basic` and `hosting`.
- Publishing a site and changing domains require explicit customer confirmation (`ApprovalRequest`).
