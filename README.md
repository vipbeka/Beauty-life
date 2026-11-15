# Beauty Life — Full Site Source

Source: https://beautylife1-890ae.web.app
Source: https://beautylife-eg.com
## Pages
| File | Purpose |
|---|---|
| `index.html` | الصفحة الرئيسية |
| `store.html` | المتجر |
| `track.html` | تتبع الطلب |
| `admin-login.html` | تسجيل دخول لوحة التحكم |
| `admin.html` | لوحة التحكم (Dashboard) |
| `payment-callback.html` | صفحة نتيجة الدفع |
| `404.html` | صفحة الخطأ |
| `robots.txt` | robots |

## Assets
- `css/` — `main.css`, `advanced-features.css`, `admin.css`
- `js/` — `app.js`, `data.js`, `store.js`, `payment.js`, `supabase-init.js`, `advanced-features.js`, `site-upgrade-v10.js`, `admin.js`, `advanced-admin.js`
- `assets/` — `company-logo.png`

## Notes
- All `?v=` cache-busting query strings were removed from asset references so files resolve correctly offline.
- Fonts (Google Fonts / Cairo), Font Awesome, and the Supabase JS client are loaded from CDN — internet required for full styling.
- Backend/data layer is Supabase; keys live in `js/supabase-init.js`.

## Run locally
```bash
python3 -m http.server 8080
# http://localhost:8080/index.html
```

## قفل بيانات العملاء

1. ارفع ملفات الموقع الجديدة الأول (`js/store.js` و `js/security-hardening.js`).
2. من Supabase SQL Editor شغّل `supabase-security-lockdown.sql` مرة واحدة.
3. من Authentication اقفل التسجيل العام، عشان محدش يعمل حساب ويحاول يوصل للطلبات.

السكربت لا يمسح الطلبات، ولا يغيّر مفاتيح Brevo، ولا يوقف تسجيل طلب جديد.
بعده الزائر لا يقدر يقرأ أو يعدّل الطلبات. لوحة التحكم بعد تسجيل الدخول تفضل شغالة.
التتبع يبقى لطلب واحد فقط برقم الطلب ورقم الموبايل معًا.

لا تشغّل `supabase-rls-policies.sql` ولا `supabase-storage-fix.sql`.

