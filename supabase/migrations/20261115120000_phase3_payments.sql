-- Phase 3 — server-side checkout + payment transactions (ADDITIVE; no data deleted, no policy dropped).
-- * create_checkout_order(jsonb): service-role-only, ONE transaction: prices from products,
--   coupon (atomic), shipping (same rules as BL.quoteShipping), order + items + payment_transactions.
-- * apply_payment_event(...): service-role-only, idempotent forward-only status machine used by
--   the signed webhooks (paymob-webhook, stripe-webhook).
-- * payment_status(order_number, token): public read of ONE order's payment state (callback page).
-- * guard_public_order: trusts the service role (server checkout) and marks all online methods 'pending'.

-- ---------- Tables ----------
create table if not exists public.payment_transactions (
  id                 uuid primary key default gen_random_uuid(),
  order_id           text not null references public.orders (id) on delete cascade,
  provider           text not null check (provider in ('paymob', 'stripe', 'instapay', 'bank', 'cod')),
  method             text not null check (method in ('card', 'wallet', 'valu', 'stripe', 'instapay', 'bank', 'cod')),
  status             text not null default 'pending'
                       check (status in ('pending', 'awaiting_transfer', 'paid', 'failed', 'refunded', 'cancelled')),
  amount_cents       bigint not null check (amount_cents >= 0),
  currency           text not null default 'EGP',
  provider_intent_id text,
  provider_txn_id    text unique,
  is_live            boolean not null default false,
  raw                jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists payment_transactions_order_idx on public.payment_transactions (order_id);
create index if not exists payment_transactions_intent_idx on public.payment_transactions (provider_intent_id);

create table if not exists public.payment_events (
  id          bigserial primary key,
  provider    text not null,
  signature_ok boolean not null,
  event_type  text,
  txn_id      uuid,
  result      jsonb,
  payload     jsonb,
  received_at timestamptz not null default now()
);
create index if not exists payment_events_received_idx on public.payment_events (received_at desc);

alter table public.payment_transactions enable row level security;
alter table public.payment_events enable row level security;
revoke all on table public.payment_transactions, public.payment_events from anon, authenticated;
grant select on table public.payment_transactions, public.payment_events to authenticated;
drop policy if exists payment_transactions_admin_read on public.payment_transactions;
create policy payment_transactions_admin_read on public.payment_transactions for select to authenticated using (public.is_admin());
drop policy if exists payment_events_admin_read on public.payment_events;
create policy payment_events_admin_read on public.payment_events for select to authenticated using (public.is_admin());

alter table public.orders add column if not exists payment_ref text;
alter table public.orders add column if not exists pricing_source text;
comment on column public.orders.pricing_source is 'server = totals computed by create_checkout_order; null/client = legacy browser totals';

-- ---------- Insert guard: trust the server, pending for every online method ----------
create or replace function public.guard_public_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin()
     or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  new.status := 'pending';
  new.created_at := now();
  if coalesce(new.payment_method, '') in ('visa', 'stripe', 'card', 'wallet', 'valu', 'instapay', 'bank') then
    new.payment_status := 'pending';
  else
    new.payment_status := 'unpaid';
  end if;
  new.admin_notes := null;
  new.pricing_source := null;
  return new;
end;
$$;

-- ---------- Free-shipping badge (mirror of js BL.badgeBehaviorFromMeta / J()) ----------
create or replace function public.product_has_free_shipping(p_badge text, p_badges jsonb)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(p_badge, '') ~* '(free\s*shipping|شحن\s*مجاني)'
      or exists (
        select 1
          from jsonb_array_elements(case when jsonb_typeof(p_badges) = 'array' then p_badges else '[]'::jsonb end) b
         where (b ->> 'expires_at' is null or (b ->> 'expires_at')::timestamptz > now())
           and (
             lower(coalesce(b ->> 'behavior', b ->> 'type', b ->> 'slug', b ->> 'kind', '')) = 'free_shipping'
             or (coalesce(b ->> 'behavior', b ->> 'type', b ->> 'slug', b ->> 'kind', '') = ''
                 and (coalesce(b ->> 'label', '') || ' ' || coalesce(b ->> 'icon', '')) ~* '(free\s*shipping|شحن\s*مجاني)')
           )
      );
$$;

-- ---------- Server checkout ----------
create or replace function public.create_checkout_order(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s          jsonb := coalesce((select value from public.settings where key = 'store'), '{}'::jsonb);
  v_items    jsonb := p -> 'items';
  it         jsonb;
  prod       record;
  q          int;
  v_sub      numeric := 0;
  v_lines    jsonb := '[]'::jsonb;
  v_free     boolean := false;
  v_ship_t   text := case when p ->> 'ship_type' = 'international' then 'international' else 'local' end;
  v_gov      text := btrim(coalesce(p ->> 'governorate', ''));
  v_method   text := lower(btrim(coalesce(p ->> 'payment_method', 'cod')));
  v_code     text := btrim(coalesce(p ->> 'coupon_code', ''));
  v_dry      boolean := coalesce((p ->> 'dry_run')::boolean, false);
  c          public.coupons%rowtype;
  v_disc     numeric := 0;
  v_after    numeric;
  v_ship     numeric;
  v_total    numeric;
  v_map      jsonb;
  v_rate     numeric;
  v_phone    text := regexp_replace(coalesce(p #>> '{customer,phone}', ''), '[^0-9+]', '', 'g');
  v_id       text;
  v_num      text;
  v_token    uuid;
  v_txn      uuid;
  v_provider text;
  v_status   text;
  i          int;
begin
  -- ----- validate cart -----
  if jsonb_typeof(v_items) is distinct from 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'empty_cart' using errcode = 'P0001';
  end if;
  if jsonb_array_length(v_items) > 50 then
    raise exception 'cart_too_large' using errcode = 'P0001';
  end if;

  for it in select value from jsonb_array_elements(v_items) loop
    q := coalesce((it ->> 'qty')::int, 0);
    if q < 1 or q > 99 then raise exception 'bad_qty' using errcode = 'P0001'; end if;
    select pr.id, pr.name, pr.price, pr.stock, pr.image_url, pr.warranty, pr.badge, pr.badges
      into prod
      from public.products pr
     where pr.id = it ->> 'product_id' and coalesce(pr.is_active, true);
    if not found then raise exception 'product_unavailable:%', it ->> 'product_id' using errcode = 'P0001'; end if;
    if coalesce(prod.stock, 0) <= 0 then raise exception 'out_of_stock:%', prod.id using errcode = 'P0001'; end if;
    if prod.price is null or prod.price < 0 then raise exception 'bad_price:%', prod.id using errcode = 'P0001'; end if;
    v_sub := v_sub + prod.price * q;
    if public.product_has_free_shipping(prod.badge, prod.badges) then v_free := true; end if;
    v_lines := v_lines || jsonb_build_object(
      'id', prod.id, 'product_id', prod.id, 'name', prod.name, 'price', prod.price, 'qty', q,
      'image_url', coalesce(prod.image_url, ''), 'warranty', coalesce(prod.warranty, ''),
      'badges', coalesce(prod.badges, '[]'::jsonb),
      'free_shipping', public.product_has_free_shipping(prod.badge, prod.badges));
  end loop;

  -- ----- coupon (locked; redeemed only on real orders) -----
  if v_code <> '' then
    select * into c from public.coupons where lower(code) = lower(v_code) limit 1 for update;
    if not found or c.is_active is not true
       or (c.expires_at is not null and c.expires_at < now())
       or (coalesce(c.max_uses, 0) > 0 and coalesce(c.used_count, 0) >= c.max_uses)
       or (coalesce(c.min_order, 0) > 0 and v_sub < c.min_order) then
      raise exception 'coupon_invalid' using errcode = 'P0001';
    end if;
    v_disc := case when c.discount_type = 'percent' then round(v_sub * coalesce(c.discount_value, 0) / 100, 2)
                   else coalesce(c.discount_value, 0) end;
    v_disc := least(greatest(v_disc, 0), v_sub);
  end if;
  v_after := greatest(v_sub - v_disc, 0);

  -- ----- shipping (identical rules to js BL.quoteShipping) -----
  if v_ship_t = 'international' then
    if (s ->> 'internationalShippingEnabled') = 'false' then raise exception 'international_disabled' using errcode = 'P0001'; end if;
    v_rate := coalesce(nullif(s ->> 'internationalShippingTaxPercent', '')::numeric, 0);
    if coalesce((s ->> 'internationalShippingPercentEnabled')::boolean, true) and v_rate > 0 then
      v_ship := round(v_after * v_rate / 100);
    else
      v_ship := coalesce(nullif(s ->> 'internationalShippingFee', '')::numeric, 0);
    end if;
  elsif v_free then
    v_ship := 0;
  elsif coalesce(nullif(s ->> 'freeShippingAbove', '')::numeric, 0) > 0
        and v_after >= (s ->> 'freeShippingAbove')::numeric then
    v_ship := 0;
  else
    v_ship := coalesce(nullif(s ->> 'localShippingFee', '')::numeric, 0);
    if coalesce(s ->> 'localShippingMode', 'default') = 'custom' and v_gov <> '' then
      v_map := s -> 'localShippingByGovernorate';
      if jsonb_typeof(v_map) = 'object' and coalesce(v_map ->> v_gov, '') <> '' then
        v_ship := (v_map ->> v_gov)::numeric;
      end if;
    end if;
  end if;
  v_total := v_after + v_ship;

  if v_dry then
    return jsonb_build_object('ok', true, 'dry_run', true, 'items', v_lines, 'subtotal', v_sub, 'discount', v_disc,
                              'shipping_fee', v_ship, 'total', v_total, 'currency', 'EGP');
  end if;

  -- ----- customer validation + flood control -----
  if btrim(coalesce(p #>> '{customer,name}', '')) = '' or length(v_phone) < 8
     or btrim(coalesce(p #>> '{customer,address}', '')) = '' then
    raise exception 'missing_customer' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders o
       where regexp_replace(coalesce(o.customer_phone, ''), '[^0-9+]', '', 'g') = v_phone
         and o.created_at > now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if v_method not in ('cod', 'card', 'wallet', 'valu', 'stripe', 'instapay', 'bank') then
    raise exception 'bad_method' using errcode = 'P0001';
  end if;

  if v_code <> '' then
    update public.coupons set used_count = coalesce(used_count, 0) + 1 where id = c.id;
  end if;

  -- ----- create order (unique number with retry) -----
  v_id := 'o_' || replace(gen_random_uuid()::text, '-', '');
  for i in 1..6 loop
    v_num := 'BL-' || lpad((floor(random() * 1000000))::int::text, 6, '0') || '-' ||
             upper(substr(md5(gen_random_uuid()::text), 1, 3));
    exit when not exists (select 1 from public.orders where order_number = v_num);
  end loop;

  insert into public.orders (
    id, order_number, customer_name, customer_phone, customer_email, address, customer_address, city,
    governorate, country, shipping_type, payment_method, payment_status, payment_provider, status,
    items, subtotal, discount, coupon_code, shipping_fee, shipping_cost, total, notes, pricing_source)
  values (
    v_id, v_num, btrim(p #>> '{customer,name}'), btrim(p #>> '{customer,phone}'), nullif(btrim(coalesce(p #>> '{customer,email}', '')), ''),
    btrim(p #>> '{customer,address}'), btrim(p #>> '{customer,address}'), nullif(btrim(coalesce(p #>> '{customer,city}', '')), ''),
    case when v_ship_t = 'local' then nullif(v_gov, '') else null end,
    case when v_ship_t = 'international' then nullif(btrim(coalesce(p ->> 'country', '')), '') else 'مصر' end,
    v_ship_t, v_method, case when v_method = 'cod' then 'unpaid' else 'pending' end,
    case v_method when 'cod' then 'cod' when 'stripe' then 'stripe' when 'instapay' then 'instapay' when 'bank' then 'bank' else 'paymob' end,
    'pending', v_lines, v_sub, v_disc, nullif(v_code, ''), v_ship, v_ship, v_total,
    nullif(btrim(coalesce(p #>> '{customer,notes}', '')), ''), 'server')
  returning public_token into v_token;

  insert into public.order_items (order_id, product_id, product_name, price, quantity, total, meta)
  select v_id, l ->> 'product_id', l ->> 'name', (l ->> 'price')::numeric, (l ->> 'qty')::int,
         (l ->> 'price')::numeric * (l ->> 'qty')::int,
         jsonb_build_object('image_url', l ->> 'image_url', 'warranty', l ->> 'warranty', 'badges', l -> 'badges',
                            'free_shipping', (l ->> 'free_shipping')::boolean)
    from jsonb_array_elements(v_lines) l;

  if v_method <> 'cod' then
    v_provider := case v_method when 'stripe' then 'stripe' when 'instapay' then 'instapay' when 'bank' then 'bank' else 'paymob' end;
    v_status := case when v_method in ('instapay', 'bank') then 'awaiting_transfer' else 'pending' end;
    insert into public.payment_transactions (order_id, provider, method, status, amount_cents, currency, is_live)
    values (v_id, v_provider, v_method, v_status, round(v_total * 100)::bigint, 'EGP', coalesce((p ->> 'is_live')::boolean, false))
    returning id into v_txn;
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_id, 'order_number', v_num, 'public_token', v_token,
                            'txn_id', v_txn, 'items', v_lines, 'subtotal', v_sub, 'discount', v_disc,
                            'shipping_fee', v_ship, 'total', v_total, 'amount_cents', round(v_total * 100)::bigint,
                            'currency', 'EGP', 'payment_method', v_method);
end;
$$;
revoke all on function public.create_checkout_order(jsonb) from public, anon, authenticated;
grant execute on function public.create_checkout_order(jsonb) to service_role;

-- ---------- Webhook state machine ----------
create or replace function public.apply_payment_event(
  p_txn uuid, p_status text, p_amount_cents bigint, p_currency text,
  p_provider_txn_id text, p_raw jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.payment_transactions%rowtype;
  allowed boolean;
begin
  select * into t from public.payment_transactions where id = p_txn for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'txn_not_found'); end if;

  if p_status = 'paid' and (p_amount_cents is distinct from t.amount_cents or upper(coalesce(p_currency, '')) <> upper(t.currency)) then
    insert into public.payment_events (provider, signature_ok, event_type, txn_id, result, payload)
    values (t.provider, true, 'amount_mismatch', t.id,
            jsonb_build_object('expected', t.amount_cents, 'got', p_amount_cents, 'currency', p_currency), p_raw);
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  allowed := case
    when t.status = p_status then false                                   -- idempotent replay
    when p_status = 'paid'     then t.status in ('pending', 'awaiting_transfer', 'failed', 'cancelled')
    when p_status = 'failed'   then t.status in ('pending', 'awaiting_transfer')
    when p_status = 'refunded' then t.status = 'paid'
    when p_status = 'cancelled' then t.status in ('pending', 'awaiting_transfer')
    else false end;

  if not allowed then
    return jsonb_build_object('ok', true, 'changed', false, 'status', t.status, 'order_id', t.order_id);
  end if;

  update public.payment_transactions
     set status = p_status,
         provider_txn_id = coalesce(nullif(p_provider_txn_id, ''), provider_txn_id),
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(p_status, p_raw),
         updated_at = now()
   where id = t.id;

  update public.orders
     set payment_status = case p_status when 'cancelled' then 'failed' else p_status end,
         payment_ref = coalesce(nullif(p_provider_txn_id, ''), payment_ref),
         updated_at = now()
   where id = t.order_id;

  return jsonb_build_object('ok', true, 'changed', true, 'status', p_status, 'order_id', t.order_id);
end;
$$;
revoke all on function public.apply_payment_event(uuid, text, bigint, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.apply_payment_event(uuid, text, bigint, text, text, jsonb) to service_role;

-- ---------- Callback page status (one order, needs its secret token) ----------
create or replace function public.payment_status(p_order_number text, p_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('order_number', o.order_number, 'status', o.status, 'payment_status', o.payment_status,
                            'payment_method', o.payment_method, 'total', o.total)
    from public.orders o
   where o.order_number = p_order_number
     and o.public_token::text = btrim(coalesce(p_token, ''))
   limit 1;
$$;
revoke all on function public.payment_status(text, text) from public;
grant execute on function public.payment_status(text, text) to anon, authenticated, service_role;
