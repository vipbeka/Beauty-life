-- Phase 2a (ADDITIVE ONLY — no policy is dropped, no data deleted).
-- 1) Server-side admin identity: admin_users + is_admin()
-- 2) Per-order random public_token for WhatsApp confirmation links
-- Apply only after inspecting live state (see docs/PHASE2_RUNBOOK.md). Runs in one transaction:
-- if no admin account can be seeded it aborts, so the admin panel can never be locked out.

-- ---------- 1. Admin identity ----------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;
revoke all on table public.admin_users from anon, authenticated;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admin_users a where a.user_id = auth.uid())
      or coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false);
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

-- Seed from the emails the site currently trusts (js/supabase-init.js BL_ADMIN_EMAILS).
insert into public.admin_users (user_id, note)
select id, 'seeded from BL_ADMIN_EMAILS ' || email
from auth.users
where lower(email) in ('beauty@admin.com', 'admin@beautylife.com')
on conflict (user_id) do nothing;

do $$
begin
  if (select count(*) from public.admin_users) = 0 then
    raise exception 'No admin user found to seed — aborting so the admin panel is not locked out. Add the real admin email to the seed list.';
  end if;
end $$;

-- ---------- 2. Order public token (lock-light: no table rewrite) ----------
alter table public.orders add column if not exists public_token uuid;            -- instant (nullable, no default)
alter table public.orders alter column public_token set default gen_random_uuid(); -- instant (new rows only)
update public.orders set public_token = gen_random_uuid() where public_token is null; -- row-level locks only
create unique index if not exists orders_public_token_key on public.orders (public_token);

comment on column public.orders.public_token is 'Random secret used in customer confirmation/tracking links (replaces last-4-digits-of-phone key).';
