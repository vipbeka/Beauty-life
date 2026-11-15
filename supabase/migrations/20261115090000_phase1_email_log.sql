-- Phase 1 (additive only): email delivery log used by the send-order-email Edge Function
-- for idempotency (one email per event/record) and rate limiting.
-- Safe to run on production: creates a new table, touches no existing data.

create table if not exists public.email_log (
  id           bigserial primary key,
  dedupe_key   text not null unique,
  event        text not null,
  record_id    text,
  role         text not null check (role in ('admin', 'customer')),
  recipient    text,
  source       text not null check (source in ('anon', 'admin', 'test')),
  status       text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  message_id   text,
  error        text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create index if not exists email_log_created_at_idx on public.email_log (created_at desc);
create index if not exists email_log_recipient_idx  on public.email_log (recipient, created_at desc);
create index if not exists email_log_source_idx     on public.email_log (source, created_at desc);

-- Service role only: RLS on with no policies, and no grants to client roles.
alter table public.email_log enable row level security;
revoke all on table public.email_log from anon, authenticated;
revoke all on sequence public.email_log_id_seq from anon, authenticated;

comment on table public.email_log is 'Server-side email delivery log (send-order-email). Not readable by anon/authenticated.';
