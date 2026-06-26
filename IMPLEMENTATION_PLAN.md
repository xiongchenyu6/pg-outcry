# Implementation Plan — pure-PG CEX on Supabase

Target stack: **PostgREST + Supabase Realtime + Supabase Auth (GoTrue)**, matching
core = open-outcry PL/pgSQL. No application service in the request path.

## Stage 1: Migrate the SQL matching engine
**Goal**: open-outcry's engine runs on Supabase Postgres, drivable via PostgREST, events over Realtime.
**Success Criteria**:
- All engine SQL applies as Supabase migrations from a clean `db reset`. ✅
- A crossing order pair placed via PostgREST `/rpc` produces a `trade`. ✅
- The trade is delivered over a Supabase Realtime websocket. ✅
**Status**: Complete

## Stage 2: Balances / reservations / settlement / risk / market data
**Goal**: a safe, observable trading surface.
**Tasks**:
- ✅ Concurrency: `submit_order` / `submit_cancel` take `pg_advisory_xact_lock(instrument_id)` so matching is serialized per instrument (replaces Go's SERIALIZABLE tx). `9100_*`.
- ✅ Read APIs (views, PostgREST-exposed): `order_book_l2`, `open_orders`, `trade_history`, `cash_balances`, `instrument_balances` (available vs reserved). Verified by `scripts/smoke-stage2.sh` incl. double-entry settlement + frozen balance.
- ✅ Public market-data push: `price_level` (L2) + `trade` (tape) published to Realtime; verified by `scripts/smoke-marketdata.mjs`. (Realtime needs ~4s to attach the slot for a freshly-published table after `db reset`.)
- ✅ Risk controls `9500_*`: per-instrument `instrument_risk` (max order amount, max notional, price band vs last trade); enforced in `place_order` (user path; admin `submit_order` bypasses). Verified by `scripts/smoke-stage5.sh`.
- ✅ Platform `9700_*`: `statement_timeout` raised per role (authenticated 15s / anon 10s / service_role 30s). No `serialization_failure` retry needed — advisory locks (not SERIALIZABLE) serialize per instrument, callers queue on the lock.
- ✅ Authenticated PRIVATE feed `9310_*`: publish `wallet_request`; with `trade_order` already RLS-scoped + published, a client that calls `realtime.setAuth(jwt)` receives ONLY its own order lifecycle (incl. fills, maker & taker) + wallet status — Postgres Changes enforces RLS per subscriber, no cross-leak. Verified by `scripts/smoke-stage6.mjs`; client pattern in `examples/private-feed.mjs`.
- ✅ Order-type coverage: MARKET / IOC / FOK verified through the API (`scripts/smoke-stage8.sh`). MARKET uses `price=0` sentinel; STOPLOSS/STOPLIMIT placement + trigger activation verified (`scripts/smoke-stage9.sh`): a same-side trade at or through the stop price converts STOPLOSS→MARKET, STOPLIMIT→LIMIT.
**Status**: Complete (concurrency, read API, market-data push, risk, platform tuning, authed private feed, order types).

## Stage 3: Auth + RLS (back-office foundations)
**Goal**: replace Stage-1 blanket grants with Supabase Auth identity + RLS.
**Decision**: register == open account (GoTrue signup auto-provisions the entity).
**Tasks**:
- ✅ `app_user` link table + `on_auth_user_created` trigger -> `create_client`; `current_app_entity_id()/_pub()` resolve `auth.uid()`. `9200_*`.
- ✅ `place_order` / `cancel_order`: authenticated users trade their OWN account (resolved from JWT), per-instrument advisory lock, ownership checks.
- ✅ RLS: owner-scoped SELECT on app_entity/app_user/currency_account/instrument_account/holding/trade_order; default-deny on ledger/transfer/stop_order/book_order; market data (price_level/trade/instrument/currency) public. Views set `security_invoker`.
- ✅ Hardening `9400_*`: revoke EXECUTE on ALL engine functions from public/anon/authenticated, re-grant only the API whitelist; `service_role` = admin plane. Verified anon/authenticated cannot reach internal helpers (`create_trade`, `update_price_level`, …).
- ✅ Back-office `9600_*`: `app_entity.status` (ACTIVE/SUSPENDED) enforced on trade + withdrawal; admin RPCs `admin_suspend_entity` / `admin_unsuspend_entity` / `admin_set_fee` / `admin_set_instrument_risk`; `admin_audit_log`. Verified by `scripts/smoke-stage5.sh`.
**Status**: Complete (identity + RLS + lockdown + back-office admin, verified by `scripts/smoke-stage3.sh` and `smoke-stage5.sh`).

## Stage 4: Wallet (deposits & withdrawals)
**Goal**: on/off-ramp into the ledger. **Decision**: internal-ledger wallet (no chain/bank yet).
**Tasks**:
- ✅ `wallet_request` table + `request_deposit` / `request_withdrawal` (reserves funds) for users; `approve_wallet_request` / `reject_wallet_request` for admins. `9300_*`.
- ✅ Settles through the engine ledger (DEPOSIT MASTER→user, WITHDRAWAL user→MASTER); withdrawal hold released on approve/reject. RLS-scoped history; admin-only resolution. Verified by `scripts/smoke-stage4.sh`.
- ✅ Idempotency keys `9320_*`: `request_deposit` / `request_withdrawal` take an optional key; replays/concurrent dups return the same request, never double-reserve.
- ✅ Append-only ledger + reconciliation `9330_*`: ledger entry tables reject UPDATE/DELETE; `reconcile()` / `reconciliation_report` check 5 invariants (cash==ledger, double-entry balanced, reservations sane, approved-wallet-has-transfer, issuance conserved). Verified by `scripts/smoke-stage7.sh`.
- ⬜ External rails (chain indexer / bank) — deferred (would add off-PG components).
**Status**: Internal-ledger wallet complete incl. idempotency + reconciliation; external rails deferred.

## Cross-cutting / open questions
- Realtime authorization model once RLS is on (postgres_changes vs broadcast-from-db + RLS on `realtime.messages`).
- Drop unused FIX tables (`pkg/fix/*`) unless FIX ingress is wanted.
- Numeric precision / banker's rounding already in engine (`banker_round`).
- Packaging for the user's Nix flake env (devshell with supabase CLI pinned).
