#!/bin/sh
# Container entry: optionally apply database migrations (hosts without a pre-deploy step, e.g. Render's free plan),
# then hand the process over to the API so signals reach it directly.
set -e
if [ "$RUN_MIGRATIONS_ON_START" = "true" ]; then
  echo "Applying database migrations..."
  (cd /migrate && npx prisma migrate deploy)
fi
exec node dist/main.js
