#!/usr/bin/env bash
# Local high-performance profile: native C banker_round + write-throughput tunables.
# Self-host / local only (these need superuser; not available on hosted Supabase).
# Re-run after `supabase db reset`.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CID="$(docker ps --format '{{.Names}}' | grep -i supabase_db | head -1)"
[ -n "$CID" ] || { echo "supabase_db container not found; run 'supabase start'"; exit 1; }

echo "== native C banker_round (drop-in) =="
"$HERE/../ext/oc_fastmath/build.sh"

echo "== DB tunables (ALTER SYSTEM as supabase_admin) =="
docker exec -i "$CID" psql -U supabase_admin -d postgres <<SQL
ALTER SYSTEM SET wal_compression = on;          -- less WAL volume
SELECT pg_reload_conf();
SQL
if [ "${RISKY:-0}" = "1" ]; then
  echo "   RISKY=1 -> synchronous_commit=off (max throughput; may lose last txns on crash)"
  docker exec -i "$CID" psql -U supabase_admin -d postgres -c "ALTER SYSTEM SET synchronous_commit = off; SELECT pg_reload_conf();"
fi

echo "== verify =="
docker exec "$CID" psql -U supabase_admin -d postgres -tAc \
  "select 'banker_round='||l.lanname from pg_proc p join pg_language l on l.oid=p.prolang where proname='banker_round';
   select 'wal_compression='||setting from pg_settings where name='wal_compression';
   select 'synchronous_commit='||setting from pg_settings where name='synchronous_commit';"
echo "done. (shared_buffers/work_mem need a restart — set in supabase/config.toml [db] if desired)"
