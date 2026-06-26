# shared helpers for smoke tests (sourced)
API="${API:-http://127.0.0.1:54321}"

# Wait until Auth + PostgREST are serving (e.g. right after `supabase db reset`,
# which can briefly leave services reconnecting on slower/CI machines).
wait_ready() {
  local i
  for i in $(seq 1 60); do
    if curl -sf "$API/auth/v1/health" >/dev/null 2>&1 \
       && curl -sf "$API/rest/v1/" -H "apikey: ${ANON:?}" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "wait_ready: services not ready after 60s" >&2; return 0
}

# Robust signup. Echoes "<access_token> <user_id>"; retries until a 3-part JWT
# (tolerates transient post-reset / rate-limit hiccups).
signup_jwt() { # $1 = email
  local r tok uid n=0
  while [ "$n" -lt 6 ]; do
    r=$(curl -s -X POST "$API/auth/v1/signup" -H "apikey: ${ANON:?}" -H "Content-Type: application/json" \
        -d "{\"email\":\"$1\",\"password\":\"password123\"}")
    tok=$(printf '%s' "$r" | jq -r '.access_token // empty')
    uid=$(printf '%s' "$r" | jq -r '.user.id // empty')
    case "$tok" in *.*.*) printf '%s %s' "$tok" "$uid"; return 0;; esac
    n=$((n + 1)); sleep 2
  done
  echo "signup_jwt failed for $1: $r" >&2; return 1
}
