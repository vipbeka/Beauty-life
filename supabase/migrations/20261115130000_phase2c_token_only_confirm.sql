-- Phase 2c — run ONLY after the new frontend (js/whatsapp-confirm.js using public_token) is live
-- AND ~7 days have passed (so WhatsApp links already sent with the old last-4 key have been used).
-- Makes order confirmation token-only.
create or replace function public.confirm_order_public(p_order_number text, p_key text default null)
returns json
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id text; v_status text; v_token text;
  k text := btrim(coalesce(p_key, ''));
begin
  select o.id::text, coalesce(o.status, 'pending'), o.public_token::text
    into v_id, v_status, v_token
    from public.orders o where o.order_number = p_order_number limit 1;
  if v_id is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if k = '' or v_token is null or k <> v_token then return json_build_object('ok', false, 'error', 'bad_key'); end if;
  if v_status = 'cancelled' then return json_build_object('ok', false, 'error', 'cancelled'); end if;
  if v_status in ('confirmed', 'processing', 'shipped', 'delivered') then
    return json_build_object('ok', true, 'already', true, 'status', v_status);
  end if;
  update public.orders set status = 'confirmed', customer_confirmed_at = now(), updated_at = now() where id::text = v_id;
  return json_build_object('ok', true, 'already', false, 'status', 'confirmed');
end;
$$;
revoke all on function public.confirm_order_public(text, text) from public;
grant execute on function public.confirm_order_public(text, text) to anon, authenticated, service_role;
