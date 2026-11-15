-- Phase 2b — RLS lockdown (NOT YET APPLIED: contains DROP POLICY → needs owner approval).
-- Tested on production inside a rolled-back transaction (see docs/PHASE2_RUNBOOK.md).
--
-- Live findings this fixes:
--  * "Allow all for anon" (role PUBLIC, FOR ALL, USING true) on products, categories, settings,
--    testimonials, coupons. PUBLIC includes every signed-in user → any account could edit prices,
--    settings, coupons. (anon is limited by grants to SELECT, so anon behaviour is unchanged.)
--  * coupons_public_read_valid lets any visitor list every valid coupon code.
--  * Unused SECURITY DEFINER functions callable by anon:
--      track_orders_by_phone(phone)  → full order rows (address, email) for any phone
--      get_order_returns / get_order_warranty_claims(order_number) → return/warranty records
--      redeem_coupon(code) → burns a coupon use on every call
--  * anon/authenticated hold TRUNCATE/TRIGGER/REFERENCES on public tables (not reachable via the
--    REST API, removed as defense in depth).
--
-- NOT changed (already correct live): orders/order_items/leads/consultations/returns/warranty —
-- anon INSERT only (no SELECT/UPDATE/DELETE), admins via is_admin(). Order creation keeps working.

begin;

-- 1) Remove the allow-all policies (replacement read/admin policies already exist live)
drop policy if exists "Allow all for anon" on public.products;
drop policy if exists "Allow all for anon" on public.categories;
drop policy if exists "Allow all for anon" on public.settings;
drop policy if exists "Allow all for anon" on public.testimonials;
drop policy if exists "Allow all for anon" on public.coupons;

-- 2) Coupons: no public listing; validation through a read-only RPC (used by js/security-hardening.js)
drop policy if exists coupons_public_read_valid on public.coupons;
revoke select on table public.coupons from anon;

create or replace function public.check_coupon(p_code text, p_subtotal numeric default 0)
returns json
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c   public.coupons%rowtype;
  sub numeric := greatest(coalesce(p_subtotal, 0), 0);
  d   numeric;
begin
  select * into c from public.coupons where lower(code) = lower(btrim(coalesce(p_code, ''))) limit 1;
  if not found or c.is_active is not true then
    return json_build_object('ok', false, 'msg', 'كود الخصم غير صحيح');
  end if;
  if c.expires_at is not null and c.expires_at < now() then
    return json_build_object('ok', false, 'msg', 'كود الخصم منتهي الصلاحية');
  end if;
  if coalesce(c.max_uses, 0) > 0 and coalesce(c.used_count, 0) >= c.max_uses then
    return json_build_object('ok', false, 'msg', 'تم استنفاد عدد استخدامات الكود');
  end if;
  if coalesce(c.min_order, 0) > 0 and sub < c.min_order then
    return json_build_object('ok', false, 'msg', 'الحد الأدنى للطلب ' || c.min_order);
  end if;
  d := case when c.discount_type = 'percent' then round(sub * coalesce(c.discount_value, 0) / 100, 2)
            else coalesce(c.discount_value, 0) end;
  return json_build_object('ok', true, 'code', c.code, 'discount_type', c.discount_type,
                           'discount_value', c.discount_value, 'discount', least(d, sub), 'subtotal', sub);
end;
$$;
revoke all on function public.check_coupon(text, numeric) from public;
grant execute on function public.check_coupon(text, numeric) to anon, authenticated, service_role;

-- 3) Unused, data-leaking RPCs: server/admin only
revoke all on function public.track_orders_by_phone(text)      from public, anon, authenticated;
revoke all on function public.get_order_returns(text)          from public, anon, authenticated;
revoke all on function public.get_order_warranty_claims(text)  from public, anon, authenticated;
revoke all on function public.redeem_coupon(text)              from public, anon, authenticated;
grant execute on function public.track_orders_by_phone(text), public.get_order_returns(text),
                          public.get_order_warranty_claims(text), public.redeem_coupon(text) to service_role;

-- 4) Grant hygiene: client roles never need TRUNCATE / TRIGGER / REFERENCES
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate, trigger, references on table public.%I from anon, authenticated', t);
  end loop;
end $$;

commit;
