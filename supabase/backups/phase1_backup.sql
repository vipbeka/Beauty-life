-- Phase 1 backup (read existing data → copy into a private schema). Additive, non-destructive.
-- Run ONCE in Supabase SQL Editor before any change. The schema is not exposed via the API.
create schema if not exists backup_20261115;
revoke all on schema backup_20261115 from public, anon, authenticated;

create table if not exists backup_20261115.settings as table public.settings;
create table if not exists backup_20261115.pg_policies as
  select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check from pg_policies;
create table if not exists backup_20261115.table_rls as
  select n.nspname as schemaname, c.relname as tablename, c.relrowsecurity as rls_enabled, c.relforcerowsecurity as rls_forced
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'storage');
create table if not exists backup_20261115.grants as
  select table_schema, table_name, grantee, privilege_type from information_schema.role_table_grants
  where table_schema in ('public', 'storage') and grantee in ('anon', 'authenticated', 'public');
create table if not exists backup_20261115.functions as
  select n.nspname as schema, p.proname as name, pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef as security_definer, pg_get_functiondef(p.oid) as definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';

create table if not exists backup_20261115.function_acl as
  select p.proname as name, pg_get_function_identity_arguments(p.oid) as args, p.proacl::text as acl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
-- Small data tables: full copies for a complete restore point
create table if not exists backup_20261115.orders       as table public.orders;
create table if not exists backup_20261115.order_items  as table public.order_items;
create table if not exists backup_20261115.products     as table public.products;
create table if not exists backup_20261115.categories   as table public.categories;
create table if not exists backup_20261115.coupons      as table public.coupons;
create table if not exists backup_20261115.leads        as table public.leads;
create table if not exists backup_20261115.admin_users  as table public.admin_users;
revoke all on all tables in schema backup_20261115 from public, anon, authenticated;

-- Verify (expect counts > 0):
select (select count(*) from backup_20261115.settings) settings_rows,
       (select count(*) from backup_20261115.pg_policies) policies,
       (select count(*) from backup_20261115.grants) grants,
       (select count(*) from backup_20261115.functions) functions,
       (select count(*) from backup_20261115.orders) orders,
       (select count(*) from backup_20261115.products) products,
       (select count(*) from backup_20261115.leads) leads;
