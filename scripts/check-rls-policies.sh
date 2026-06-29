#!/usr/bin/env bash
# RLS invariant guard. A security_invoker view that reads a table with RLS ENABLED but
# ZERO policies silently returns nothing — the recurring Supabase auto-RLS footgun
# (hit on stake_pool / perp_market / chain_deposit). This fails CI, listing any
# security_invoker view (granted to anon/authenticated) whose base table is RLS-on-no-policy.
# Fix by adding a SELECT policy (own-row or public-read) to the offending table.
set -euo pipefail
PGURL="${PGURL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"

offenders=$(psql "$PGURL" -X -t -A <<'SQL'
select distinct v.relname || '  ->  ' || t.relname
from pg_class v
join pg_namespace nv on nv.oid = v.relnamespace and nv.nspname = 'public'
join pg_rewrite rw on rw.ev_class = v.oid
join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = rw.oid and d.refclassid = 'pg_class'::regclass
join pg_class t on t.oid = d.refobjid and t.relkind in ('r','p') and t.oid <> v.oid
join pg_namespace nt on nt.oid = t.relnamespace and nt.nspname = 'public'
where v.relkind = 'v'
  and coalesce((select option_value from pg_options_to_table(v.reloptions) where option_name = 'security_invoker'), 'off') = 'on'
  and exists (select 1 from information_schema.role_table_grants g
              where g.table_schema = 'public' and g.table_name = v.relname
                and g.grantee in ('anon','authenticated') and g.privilege_type = 'SELECT')
  and t.relrowsecurity = true
  and not exists (select 1 from pg_policy p where p.polrelid = t.oid)
order by 1;
SQL
)

if [ -n "$offenders" ]; then
  echo "FAIL: security_invoker view(s) read an RLS-enabled table with NO policy:" >&2
  echo "$offenders" | sed 's/^/  /' >&2
  echo "Add a SELECT policy (own-row or public-read) to those tables — see migration 9999." >&2
  exit 1
fi
echo "RLS invariant OK: every security_invoker view's base tables are readable (policy or RLS-off)."
