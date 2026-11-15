# Phase 1 runbook: backup, admin XSS fix, server-side email

Every step is additive or reversible. COD checkout and browsing keep working throughout.

The order below guarantees that **email never stops**. The new frontend tries the server function first and falls back to the old path while the old keys still exist. The keys are removed only after the server path has been proven on production.

Project: `gyeqbsoqmghxxnnfjizd` · Branch: `ccr-4dc2b257-lb30t6` · Baseline: `backup/pre-security-fix`

---

## Step 1: Database backup (SQL Editor, about 10 s)
Run `supabase/backups/phase1_backup.sql`. The final `select` must show counts above 0.
This copies `settings`, all RLS policies, grants and RPC definitions into the private schema `backup_20261115`.

## Step 2: Create the `email_log` table (SQL Editor)
Run `supabase/migrations/20261115090000_phase1_email_log.sql`. This creates a new table only and touches no existing data.

## Step 3: Copy the existing Brevo keys into Edge Function Secrets
1. Read the current values (SQL Editor). This shows them only to you:
   ```sql
   select value->>'brevoApiKey' as brevo_api_key,
          value->>'customerBrevoApiKey' as brevo_customer_api_key
   from settings where key = 'store';
   ```
2. Go to Supabase Dashboard → **Edge Functions → Secrets** → add:
   - `BREVO_API_KEY` = value of `brevo_api_key`
   - `BREVO_CUSTOMER_API_KEY` = value of `brevo_customer_api_key` (skip if empty; customer emails then stay off, as they are today)

   Or with the CLI:
   ```bash
   supabase secrets set --project-ref gyeqbsoqmghxxnnfjizd BREVO_API_KEY='…' BREVO_CUSTOMER_API_KEY='…'
   ```
3. Later you can rotate a key by changing only the secret value. No code or site change is needed.

## Step 4: Deploy the Edge Function
```bash
supabase functions deploy send-order-email --project-ref gyeqbsoqmghxxnnfjizd
```
(Keep JWT verification **on**, the default. The site's anon key is a JWT.)

## Step 5: Deploy the new frontend to a Firebase **preview channel** (production untouched)
```bash
git checkout ccr-4dc2b257-lb30t6
firebase hosting:channel:deploy phase1 --project beautylife1-890ae --expires 7d
```
Open the preview URL, then work through these checks:
- [ ] Log in to `/admin.html`. In **Settings**, the Brevo key fields are replaced by a 🔒 notice. Click **"إرسال إيميل تجريبي من السيرفر"**: you should receive one test email per key (admin key, plus customer key if set).
- [ ] In the browser console on admin: `await BLServerMail.health()` → `secrets.BREVO_API_KEY: true`, `email_log: true`.
- [ ] On the preview store, place a COD order with your own email. You should get **one** admin email and **one** customer email. (Production currently sends duplicates.)
- [ ] DevTools → Network: **no** request to `api.brevo.com`; one or more requests to `/functions/v1/send-order-email` with status 200.
- [ ] SQL: `select event, role, status, created_at from email_log order by id desc limit 10;` shows `sent`.
- [ ] Open that order in admin: names, items and quantities display normally.

## Step 6: Promote to production (atomic, about 1 min)
```bash
firebase deploy --only hosting --project beautylife1-890ae
```
Then repeat the order test on `https://beautylife-eg.com`.
Rollback: Firebase Console → Hosting → Release history → **Rollback** (instant).

## Step 7: Remove the keys from the public `settings` row (after Step 6 is verified)
Run `supabase/backups/phase1_scrub_brevo_keys.sql`. It refuses to run without the backup. The verify query must show `false / false`.
Then confirm `BLServerMail.health()` → `settings_legacy_keys_present: {brevoApiKey:false, customerBrevoApiKey:false}`, and place one more test order.

Rollback (if ever needed) is the commented `update … from backup_20261115.settings` at the bottom of that file.

## Step 8: Rotate the keys in Brevo (recommended, any time after Step 7)
The old keys were public for a long time. Create new keys in Brevo, update only the two Secrets, click the server test button, then delete the old keys in Brevo.

---

### What changed in code (Phase 1)
| File | Change |
|---|---|
| `js/admin.js` | `__blJs()` lossless encoder for 28 inline `onclick` IDs; escaped `qty`, `shipping_type`, `payment_method`; numeric item count |
| `js/app.js` | Same encoder for 5 storefront `onclick` IDs; escaped cart `qty` |
| `js/site-upgrade-v10.js` | Admin and customer notifiers try `BLServerMail` first (legacy is fallback only); settings save no longer requires or writes a Brevo key; `qty` escaped in legacy email HTML |
| `js/notify-server.js` (new) | Client bridge to `send-order-email`; replaces key inputs in admin with a secure notice and a server test button |
| `index/store/track/admin.html` | Load `js/notify-server.js` |
| `supabase/functions/send-order-email/*` (new) | Server-side email: loads the record by id, escapes all fields, dedupes via `email_log`, rate-limits anon, admin-only status/payment/test/health events |
| `supabase/migrations/…_phase1_email_log.sql` (new) | `email_log` table (service-role only) |
| `supabase/backups/*.sql` (new) | Backup and scrub scripts |
| `firebase.json` | Don't publish `supabase/`, `tests/`, `docs/`, `*.sh`, `*.ts` |

### Tests
- `tests/xss-admin.test.js`: Playwright with stubbed Supabase. Baseline is exploited; patched shows no injection and exact IDs.
- `tests/checkout-email.test.js`: COD order end-to-end, in two modes: server (0 direct Brevo calls) and not-deployed (legacy fallback still sends).
- `supabase/functions/send-order-email/handler_test.ts`: 11 Deno unit tests covering auth, dedupe, freshness, rate limits, toggles, escaping, failure/retry, health secrecy.
