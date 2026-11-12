# syntax=docker/dockerfile:1.7
# Make Your App AI — web. NEXT_PUBLIC_* values are baked in at build time:
#   docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SITE_URL=https://makeyourapp.ai ... -t mya-web .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_API_URL NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_LEGAL_COMPANY NEXT_PUBLIC_LEGAL_ADDRESS NEXT_PUBLIC_LEGAL_EMAIL NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER NEXT_PUBLIC_LEGAL_JURISDICTION NEXT_PUBLIC_LEGAL_REFUND_DAYS
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_LEGAL_COMPANY=$NEXT_PUBLIC_LEGAL_COMPANY NEXT_PUBLIC_LEGAL_ADDRESS=$NEXT_PUBLIC_LEGAL_ADDRESS NEXT_PUBLIC_LEGAL_EMAIL=$NEXT_PUBLIC_LEGAL_EMAIL \
    NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER=$NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER NEXT_PUBLIC_LEGAL_JURISDICTION=$NEXT_PUBLIC_LEGAL_JURISDICTION NEXT_PUBLIC_LEGAL_REFUND_DAYS=$NEXT_PUBLIC_LEGAL_REFUND_DAYS
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@mya/web...

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
