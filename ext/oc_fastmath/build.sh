#!/usr/bin/env bash
# Build + load the oc_fastmath C extension into the local Supabase Postgres.
#
# Why this shape: the DB is a nix-built PostgreSQL 17.6 on Alpine.
#   - real server headers live in the nix store (pg_config's path is stripped)
#   - pkglibdir is the read-only nix store, so we install the .so into PGDATA
#     (a persistent, writable docker volume) and load it by absolute path
#   - the `postgres` role is NOT superuser; C functions are created as supabase_admin
#   - a compiler is fetched on demand via the container's own `nix` (matches the PG ABI)
#
# Run after `supabase start`. Re-run after `supabase db reset` (the .so persists in
# PGDATA; only the SQL function objects need recreating — this script is idempotent).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CID="$(docker ps --format '{{.Names}}' | grep -i supabase_db | head -1)"
[ -n "$CID" ] || { echo "supabase_db container not found; run 'supabase start'"; exit 1; }

INC="$(docker exec "$CID" sh -lc 'ls -d /nix/store/*-postgresql-17.6/include/server | head -1')"
PGDATA="$(docker exec "$CID" psql -U supabase_admin -d postgres -tAc 'show data_directory')"
SO="$PGDATA/oc_fastmath.so"

echo "headers: $INC"
echo "install: $SO"

docker cp "$HERE/oc_fastmath.c" "$CID":/tmp/oc_fastmath.c
docker exec "$CID" sh -lc "
  nix --extra-experimental-features 'nix-command flakes' shell nixpkgs#gcc -c \
    gcc -O2 -shared -fPIC -I '$INC' /tmp/oc_fastmath.c -o '$SO'
"
echo "compiled."

docker exec -i "$CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<SQL
CREATE OR REPLACE FUNCTION oc_banker_round(float8, int) RETURNS float8
  AS '$SO','oc_banker_round' LANGUAGE c IMMUTABLE STRICT;
CREATE OR REPLACE FUNCTION oc_banker_round_numeric(numeric, int) RETURNS numeric
  AS '$SO','oc_banker_round_numeric' LANGUAGE c IMMUTABLE STRICT;
CREATE OR REPLACE FUNCTION oc_fastmath_version() RETURNS text
  AS '$SO','oc_fastmath_version' LANGUAGE c IMMUTABLE STRICT;
GRANT EXECUTE ON FUNCTION oc_banker_round(float8,int), oc_banker_round_numeric(numeric,int), oc_fastmath_version()
  TO postgres, anon, authenticated, service_role;
SELECT oc_fastmath_version();
SQL
# Drop-in: replace the engine's PL/pgSQL banker_round with the native C version
# (bit-identical, ~2.8x faster in isolation). CREATE OR REPLACE can't switch
# language, so DROP+CREATE. Safe: PL/pgSQL bodies resolve banker_round by name.
if [ "${SWAP_BANKER_ROUND:-1}" = "1" ]; then
  docker exec -i "$CID" psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 <<SQL
DROP FUNCTION IF EXISTS banker_round(numeric, integer);
CREATE FUNCTION banker_round(numeric, integer) RETURNS numeric
  AS '$SO','oc_banker_round_numeric' LANGUAGE c IMMUTABLE STRICT;
GRANT EXECUTE ON FUNCTION banker_round(numeric,integer) TO postgres, anon, authenticated, service_role;
SQL
  echo "engine banker_round -> native C (set SWAP_BANKER_ROUND=0 to skip)"
fi
echo "loaded. test: SELECT oc_banker_round(2.5,0), oc_banker_round(3.5,0);"
