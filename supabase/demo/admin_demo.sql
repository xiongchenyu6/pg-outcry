-- DEMO ONLY — not part of the product migrations. Exposes a READ-ONLY snapshot
-- of the back-office (reconciliation, pending approvals, accounts, fees, risk,
-- audit) so the admin console can run as a public live demo with just the anon
-- key — without ever shipping the service_role key to a browser.
--
-- This deliberately surfaces aggregate operator data to anon. That is acceptable
-- ONLY for a throwaway demo with disposable accounts. Do NOT apply to a real
-- deployment. Apply manually: psql "$DB_URL" -f supabase/demo/admin_demo.sql

create or replace function demo_admin_overview()
  returns jsonb
  language sql
  security definer
  set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'recon', coalesce((
      select jsonb_agg(jsonb_build_object(
        'check_name', check_name, 'failures', failures, 'status', status))
      from reconciliation_report), '[]'::jsonb),
    'approvals', coalesce((
      select jsonb_agg(jsonb_build_object(
        'direction', w.direction, 'currency', w.currency, 'amount', w.amount,
        'created_at', w.created_at, 'external_id', ae.external_id) order by w.created_at)
      from wallet_request w
      left join app_entity ae on ae.id = w.app_entity_id
      where w.status = 'PENDING'), '[]'::jsonb),
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'external_id', external_id, 'type', type, 'status', status) order by created_at desc)
      from app_entity), '[]'::jsonb),
    'fees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', type, 'currency_name', currency_name, 'percentage', percentage,
        'min', min, 'max', max))
      from fee), '[]'::jsonb),
    'risk', coalesce((
      select jsonb_agg(jsonb_build_object(
        'instrument', i.name, 'max_order_amount', r.max_order_amount,
        'max_order_notional', r.max_order_notional, 'price_band_pct', r.price_band_pct))
      from instrument_risk r left join instrument i on i.id = r.instrument_id), '[]'::jsonb),
    'audit', coalesce((
      select jsonb_agg(t order by t.created_at desc) from (
        select action, target, detail, created_at
        from admin_audit_log order by created_at desc limit 40) t), '[]'::jsonb),
    'stake_pools', coalesce((
      select jsonb_agg(jsonb_build_object(
        'currency', currency, 'apr', apr, 'total_staked', total_staked) order by currency)
      from stake_pool), '[]'::jsonb),
    'perp_markets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'symbol', m.symbol, 'mark_price', m.mark_price, 'funding_rate', m.funding_rate,
        'open', (select count(*) from perp_position p where p.symbol = m.symbol),
        'margin', coalesce((select sum(p.margin) from perp_position p where p.symbol = m.symbol), 0))
        order by m.symbol)
      from perp_market m), '[]'::jsonb),
    'margin_loans', coalesce((
      select jsonb_agg(jsonb_build_object('currency', currency, 'debt', debt) order by currency)
      from (select currency, sum(principal + accrued) as debt from margin_loan group by currency) g), '[]'::jsonb),
    'referrals', coalesce((
      select jsonb_agg(jsonb_build_object('label', label, 'currency', currency, 'total', total) order by total desc)
      from (
        select coalesce(ae.external_id, ae.pub_id) as label, e.currency, sum(e.amount) as total
        from referral_earning e join app_entity ae on ae.id = e.referrer_entity
        where e.paid_at is null group by 1, 2) r), '[]'::jsonb)
  );
$$;

revoke execute on function demo_admin_overview() from public;
grant execute on function demo_admin_overview() to anon, authenticated;
