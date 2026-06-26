#!/usr/bin/env bash
# Generate Supabase migrations from the vendored open-outcry SQL.
# Each engine file -> one migration, emitted in engine/manifest.txt order.
# Goose directives are stripped and only the "Up" section is kept.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENGINE="$ROOT/engine"
OUT="$ROOT/supabase/migrations"

mkdir -p "$OUT"
# wipe previously generated engine migrations (keep hand-written 9xxx_*)
find "$OUT" -name '0*_engine_*.sql' -delete 2>/dev/null || true

strip_goose() {
  # print only the lines between "+goose Up" and "+goose Down",
  # dropping StatementBegin/StatementEnd markers.
  awk '
    /-- \+goose Up/      { up=1; next }
    /-- \+goose Down/    { up=0; next }
    /-- \+goose Statement(Begin|End)/ { next }
    up { print }
  ' "$1"
}

i=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  i=$((i+1))
  name="$(printf '%s' "$f" | sed -e 's#^pkg/##' -e 's#/#_#g' -e 's#\.sql$##')"
  dest="$(printf '%s/%04d_engine_%s.sql' "$OUT" "$i" "$name")"
  {
    printf -- '-- generated from engine/%s — do not edit directly\n\n' "$f"
    strip_goose "$ENGINE/$f"
  } > "$dest"
done < "$ENGINE/manifest.txt"

echo "generated $i engine migrations into $OUT"
