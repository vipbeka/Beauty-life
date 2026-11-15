-- Phase 2a (applied 2026-11-15) — adapted to the LIVE schema found on gyeqbsoqmghxxnnfjizd.
-- Live state before: admin_users(email, created_at); is_admin() trusted the JWT *email*
-- ('beauty@admin.com','admin@beautylife.com'); 'admin@beautylife.com' has NO account, so if
-- public sign-up is open anyone could register it and become admin.
-- confirm_order_public(): an EMPTY key skipped verification entirely.
--
-- This migration (additive / tightening, no data deleted, no policy dropped):
--  1) admin_users gets user_id (bound to a real, confirmed auth user); is_admin() now trusts only
--     app_metadata.role='admin' (not user-editable) or admin_users.user_id = auth.uid().
--  2) orders.public_token (random) for confirmation links — lock-light, no table rewrite.
--  3) confirm_order_public(): requires a key; accepts public_token OR (legacy) last 4 phone digits.
--     Legacy last-4 stays accepted until the new frontend is live (see phase2c migration).
-- Aborts (rolls back everything) if no admin would remain.

-- ---------- 1. Admin identity ----------
alter table public.admin_users add column if not exists user_id uuid references auth.users (id) on delete cascade;
create unique index if not exists admin_users_user_id_key on public.admin_users (user_id) where user_id is not null;

update public.admin_users a
   set user_id = u.id
  from auth.users u
 where a.user_id is null
   and lower(u.email) = lower(a.email)
   and u.email_confirmed_at is not null;

revoke all on table public.admin_users from anon, authenticated;

do $$
begin
  if not exists (select 1 from public.admin_users where user_id is not null)
     and not exists (select 1 from auth.users where raw_app_meta_data ->> 'role' = 'admin') then
    raise exception 'No admin would remain after this migration — aborting.';
  end if;
end $$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and (
       coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
       or exists (select 1 from public.admin_users a where a.user_id = auth.uid())
     );
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------- 2. Order public token ----------
alter table public.orders add column if not exists public_token uuid;
alter table public.orders alter column public_token set default gen_random_uuid();
update public.orders set public_token = gen_random_uuid() where public_token is null;
create unique index if not exists orders_public_token_key on public.orders (public_token);
comment on column public.orders.public_token is 'Random secret for customer confirmation/tracking links (replaces last-4-digits key).';

-- ---------- 3. Confirmation RPC ----------
create or replace function public.confirm_order_public(p_order_number text, p_key text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     text;
  v_status text;
  v_phone  text;
  v_token  text;
  v_last4  text;
  k        text := btrim(coalesce(p_key, ''));
begin
  select o.id::text, coalesce(o.status, 'pending'), coalesce(o.customer_phone, ''), o.public_token::text
    into v_id, v_status, v_phone, v_token
    from public.orders o
   where o.order_number = p_order_number
   limit 1;

  if v_id is null then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  v_last4 := right(regexp_replace(v_phone, '\D', '', 'g'), 4);

  if k = '' or not (
       (v_token is not null and k = v_token)
       or (length(v_last4) = 4 and k = v_last4)       -- legacy links; removed by phase2c
     ) then
    return json_build_object('ok', false, 'error', 'bad_key');
  end if;

  if v_status = 'cancelled' then
    return json_build_object('ok', false, 'error', 'cancelled');
  end if;

  if v_status in ('confirmed', 'processing', 'shipped', 'delivered') then
    return json_build_object('ok', true, 'already', true, 'status', v_status);
  end if;

  update public.orders
     set status = 'confirmed', customer_confirmed_at = now(), updated_at = now()
   where id::text = v_id;

  return json_build_object('ok', true, 'already', false, 'status', 'confirmed');
end;
$$;
revoke all on function public.confirm_order_public(text, text) from public;
grant execute on function public.confirm_order_public(text, text) to anon, authenticated, service_role;
