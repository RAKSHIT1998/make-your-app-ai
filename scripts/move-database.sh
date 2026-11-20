#!/usr/bin/env sh
# Copies the whole platform database from one Postgres to another (for example from Render's free database,
# which expires, to Supabase's). Read-only on the source. Run it from your own computer.
#
#   SOURCE_URL='postgresql://…render…/mya'  TARGET_URL='postgresql://postgres.<ref>:…@aws-…pooler.supabase.com:5432/postgres' \
#     sh scripts/move-database.sh
#
# Needs pg_dump/psql version 18 (the Render database is Postgres 18). Without them, use Docker:
#   docker run --rm -e SOURCE_URL -e TARGET_URL -v "$PWD/scripts:/s" postgres:18 sh /s/move-database.sh
#
# Use Supabase's "Session pooler" connection string (port 5432) as TARGET_URL. The target must be empty:
# the script stops if the platform's tables already exist there.
set -eu
: "${SOURCE_URL:?Set SOURCE_URL to the current database}"
: "${TARGET_URL:?Set TARGET_URL to the new, empty database}"

if [ "$(psql "$TARGET_URL" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_name='_prisma_migrations'")" != "0" ]; then
  echo "The target already has the platform's tables. Stopping so nothing is overwritten." >&2
  exit 1
fi

echo "Copying… (the site keeps running; put it in maintenance or stop the API first so nothing is written meanwhile)"
# The public schema already exists on the target, so its CREATE/COMMENT lines are dropped.
pg_dump "$SOURCE_URL" --no-owner --no-privileges --schema=public --format=plain --quote-all-identifiers \
  | sed -e '/^CREATE SCHEMA "public";$/d' -e '/^COMMENT ON SCHEMA "public"/d' \
  | psql "$TARGET_URL" --single-transaction --set ON_ERROR_STOP=1 -q

for t in _prisma_migrations User Project GenerationRun Invoice; do
  a="$(psql "$SOURCE_URL" -tAc "select count(*) from public.\"$t\"")"
  b="$(psql "$TARGET_URL" -tAc "select count(*) from public.\"$t\"")"
  printf '%-14s source %-8s target %s\n' "$t" "$a" "$b"
  [ "$a" = "$b" ] || { echo "Row counts differ for $t." >&2; exit 1; }
done
echo "Done. Now set DATABASE_URL (transaction pooler, port 6543, exactly as Supabase shows it) and DIRECT_URL (session pooler, port 5432) on the API service, redeploy, and check /api/v1/health."
