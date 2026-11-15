# Deploy manifest: Phase 1 + Phase 2 (code)

Branch: `ccr-4dc2b257-lb30t6` · Baseline (exact production copy): `backup/pre-security-fix`
Review the full diff with: `git diff backup/pre-security-fix..ccr-4dc2b257-lb30t6`

Nothing has been deployed to production and no database change has been applied yet.

## A. Static site (Firebase Hosting): 16 files

| Status | File | Phase | What changed |
|---|---|---|---|
| M | `index.html` | 1+2 | loads `notify-server.js` and `ssot.js`; removed placeholder phone, email, address, "0" announcement, hardcoded +500/+1200 stats; JSON-LD fake `telephone` removed |
| M | `store.html` | 1+2 | same scripts; removed placeholder phone, email, address and hardcoded "فوق 5000" announcement |
| M | `track.html` | 1+2 | same scripts; removed placeholder phone and "فوق 5000" announcement |
| M | `admin.html` | 1 | loads `notify-server.js` |
| M | `admin-login.html` | 2 | admin check is server-first (`is_admin()` RPC), email list only as fallback |
| M | `css/main.css` | 2 | appended skeleton placeholder styles (`.sk`, `.sk-block`); nothing existing changed |
| M | `js/admin.js` | 1+2 | XSS fix (`__blJs` for 28 onclick IDs, escaped qty, shipping and payment); guard uses `BLAdminCheck` |
| M | `js/app.js` | 1+2 | XSS fix for 5 onclick IDs and cart qty; fake ★ (4.9) rating removed (shows only if a product has a real `rating`); no fake hero-stat fallback; shipping uses `BL.quoteShipping` |
| M | `js/data.js` | 2 | `DEFAULT_SETTINGS`: blanked fake phone, WhatsApp, email, address, bank details, announcement and stats; removed `brevoApiKey` and the personal recipient email |
| M | `js/store.js` | 2 | cart re-priced from the `products` table; one shared `BL.quoteShipping()`; `BLAdminCheck` (is_admin RPC first) |
| M | `js/site-upgrade-v10.js` | 1+2 | emails go to the server first (legacy direct path is fallback only); settings no longer save Brevo keys; shipping uses `BL.quoteShipping` |
| M | `js/whatsapp-confirm.js` | 2 | confirm link calls the `confirm_order_public` RPC directly (it was broken for customers); link uses `public_token` when present; store name and WhatsApp number come from settings |
| A | `js/notify-server.js` | 1 | client bridge to the `send-order-email` Edge Function; secure notice and test button in admin |
| A | `js/ssot.js` | 2 | hides anything the DB doesn't provide; clears skeletons; re-prices the cart when products update |
| M | `firebase.json` | 1 | `supabase/`, `tests/`, `docs/`, `*.sh`, `*.ts` are no longer published |
| M | `README.md` | 2 | security notes; removed-scripts note |

Deleted from the repo (not deployed anyway, since `*.sql` is ignored; still in the backup branch):
`fix-admin-login.sql` (weak `' beka1'` password), `supabase-rls-policies.sql` (allow-all), `supabase-storage-fix.sql` (public delete), `supabase-fix-orders.sql` (anon delete).

## B. Supabase (manual or next session): none applied yet

| Order | Item | Type | Safe to apply now? |
|---|---|---|---|
| 1 | `supabase/backups/phase1_backup.sql` | backup into private schema | ✅ yes |
| 2 | `supabase/migrations/20261115090000_phase1_email_log.sql` | new table | ✅ yes |
| 3 | Secrets `BREVO_API_KEY`, `BREVO_CUSTOMER_API_KEY` | Dashboard → Edge Functions → Secrets | ✅ yes |
| 4 | `supabase functions deploy send-order-email` (`supabase/functions/send-order-email/`) | Edge Function | ✅ yes (verify JWT on) |
| 5 | `supabase/migrations/20261115100000_phase2a_admin_and_order_token.sql` | `admin_users`, `is_admin()`, `orders.public_token` | ⚠️ after live inspection, because `confirm_order_public` must accept the token in the same release |
| 6 | Phase 2b RLS lockdown + `confirm_order_public` / `track_order` update | policies | ⏳ written after inspecting live policies |
| 7 | `supabase/backups/phase1_scrub_brevo_keys.sql` | removes keys from `settings` | ⛔ only after you confirm the Secrets and a server-sent email |

## C. Deploy order (zero downtime)
1. Run B1 → B4.
2. `firebase hosting:channel:deploy phase2 --project beautylife1-890ae --expires 7d`, then verify on the preview URL. Checks are in `docs/PHASE1_RUNBOOK.md` §5, plus:
   - [ ] Home page shows no fake phone, stats or 4.9 rating. Contact rows the DB doesn't fill stay hidden.
   - [ ] Add a product, change its price in admin, reload the store: the cart shows the new price and a toast.
   - [ ] COD checkout completes and the totals match the live site.
   - [ ] Admin login works.
3. `firebase deploy --only hosting --project beautylife1-890ae`. Rollback: Console → Hosting → Release history.
4. B5–B7 as listed.

> Before step 3, check that the DB `settings` row actually contains `phone`, `whatsapp`, `email`, `address`, `heroStats` and `announcement`/`announcementList`. Missing values now show as hidden rather than placeholder text. Query: `select value ? 'phone', value ? 'whatsapp', value ? 'heroStats', value ? 'announcementList' from settings where key='store';`

## D. Tests (all passing on this branch)
- `node tests/xss-admin.test.js .`: no injection; exact IDs.
- `node tests/checkout-email.test.js . server|notdeployed`: COD works; server email path; legacy fallback.
- `node tests/phase2-ssot.test.js .`: no fake values; DB values shown; cart re-priced; shipping identical to baseline; WhatsApp confirm works.
- `deno test supabase/functions/send-order-email/handler_test.ts`: 11/11.
