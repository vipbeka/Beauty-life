-- Phase 1 FINAL step — run ONLY after:
--   (1) backup_20261115.settings exists,
--   (2) BREVO_API_KEY / BREVO_CUSTOMER_API_KEY are set in Edge Function Secrets,
--   (3) the admin "send test email from server" succeeded, AND
--   (4) the new frontend (js/notify-server.js) is live on beautylife-eg.com and a real order email arrived via the server.
do $$
begin
  if not exists (select 1 from backup_20261115.settings) then
    raise exception 'Backup missing — run phase1_backup.sql first';
  end if;
end $$;

update public.settings
   set value = value - 'brevoApiKey' - 'brevoApiToken' - 'customerBrevoApiKey' - 'customerBrevoApiToken',
       updated_at = now()
 where value ?| array['brevoApiKey', 'brevoApiToken', 'customerBrevoApiKey', 'customerBrevoApiToken'];

-- Verify: every row must show false/false
select key, value ? 'brevoApiKey' as admin_key_left, value ? 'customerBrevoApiKey' as customer_key_left from public.settings;

-- ROLLBACK (only if needed):
-- update public.settings s set value = b.value from backup_20261115.settings b where b.key = s.key;
