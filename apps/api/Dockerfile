# syntax=docker/dockerfile:1.7
# Make Your App AI — API. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t mya-api .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @mya/db generate && pnpm turbo run build --filter=@mya/api...
# Self-contained production bundle (workspace packages + prod dependencies only).
RUN pnpm --filter @mya/api deploy --prod --legacy /out
# Migration tool: prisma CLI + schema + migrations, run as a pre-deploy step.
# `prisma version` fetches the schema engine at build time, so migrating needs no network.
RUN mkdir -p /migrate && cp -r packages/db/prisma packages/db/prisma.config.ts /migrate/ \
 && cd /migrate && echo '{"private":true,"type":"module"}' > package.json \
 && npm install --no-audit --no-fund prisma@7.10.1 dotenv@18.0.10 \
 && npx prisma version >/dev/null

FROM node:22-bookworm-slim AS runtime
# git: projects are stored as git repositories. tini: correct signal handling for graceful shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends git tini ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production API_PORT=4000 STORAGE_DIR=/data/projects NO_COLOR=1
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --from=build --chown=node:node /migrate /migrate
COPY --chown=node:node apps/api/start.sh /app/start.sh
RUN mkdir -p /data/projects && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||4000)+'/api/v1/health/live').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "/app/start.sh"]
