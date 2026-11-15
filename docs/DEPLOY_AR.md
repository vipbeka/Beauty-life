# دليل النشر — Beauty Life

الفرع: `ccr-4dc2b257-lb30t6` · النسخة الأصلية للرجوع: `backup/pre-security-fix`

## الحالة الحالية لقاعدة البيانات (beautylife)

| البند | الحالة |
|---|---|
| النسخة الاحتياطية `backup_20261115` | ✅ مطبّقة |
| جدول `email_log` | ✅ مطبّق |
| المرحلة 2a (صلاحية الأدمن + `public_token` + إصلاح تأكيد الطلب) | ✅ مطبّقة ومُختبرة |
| دالة `send-order-email` | ✅ منشورة (Active) |
| المرحلة 2b (قفل الصلاحيات) | ⏳ تنتظر ضغطك على «موافقة» في Supabase |
| المرحلة 3 (الدفع من السيرفر) | ⏳ تُطبّق بعد 2b مباشرة |
| `create-checkout` و`paymob-webhook` و`stripe-webhook` | ⏳ تُنشر بعد تطبيق المرحلة 3 (قبلها الموقع يستخدم الدفع القديم تلقائياً) |
| حذف مفاتيح Brevo من `settings` | ⛔ بعد النشر والتجربة فقط |
| المرحلة 2c (رابط التأكيد بالـ token فقط) | ⛔ بعد النشر بأسبوع |

## الملفات المطلوب رفعها على الاستضافة (Firebase)

**ملفات معدّلة (15):**
`index.html` · `store.html` · `track.html` · `admin.html` · `admin-login.html` · `payment-callback.html` · `firebase.json` · `README.md` · `css/main.css` · `js/admin.js` · `js/app.js` · `js/data.js` · `js/store.js` · `js/site-upgrade-v10.js` · `js/whatsapp-confirm.js`

**ملفات جديدة (3):**
`js/notify-server.js` · `js/ssot.js` · `js/checkout-v2.js`

**ملفات محذوفة (4، غير منشورة أصلاً):**
`fix-admin-login.sql` · `supabase-rls-policies.sql` · `supabase-storage-fix.sql` · `supabase-fix-orders.sql`

مجلدات `supabase/` و`tests/` و`docs/` لا تُنشر على الاستضافة (تم استثناؤها في `firebase.json`).

## خطوات النشر بدون توقف

1. **سحب الفرع:**
   ```bash
   git fetch origin && git checkout ccr-4dc2b257-lb30t6 && git pull
   ```
2. **نشر تجريبي أولاً (لا يؤثر على الزوار):**
   ```bash
   firebase hosting:channel:deploy test1 --project beautylife1-890ae --expires 7d
   ```
   افتح الرابط الذي يظهر، ثم:
   - [ ] الصفحة الرئيسية تعرض رقمك الحقيقي والإحصائيات الحقيقية (+5000 / +12000)، بدون تقييم 4.9 الوهمي.
   - [ ] أدخل لوحة التحكم ← الإعدادات ← اضغط «إرسال إيميل تجريبي من السيرفر»، ويجب أن تصلك رسالتان.
   - [ ] اعمل طلب تجريبي «دفع عند الاستلام» بإيميلك، ويجب أن يصلك إيميل واحد فقط (وليس 3 كما يحدث الآن).
   - [ ] افتح الطلب في لوحة التحكم وتأكد أن البيانات سليمة.
3. **النشر الفعلي:**
   ```bash
   firebase deploy --only hosting --project beautylife1-890ae
   ```
   للرجوع في أي لحظة: Firebase Console ← Hosting ← Release history ← Rollback.
4. **بعد التأكد أن الإيميلات تعمل من السيرفر:** أبلغني لأحذف مفاتيح Brevo من `settings`، ثم غيّر المفاتيح من Brevo وضع الجديدة في Secrets.

## تفعيل الدفع الإلكتروني لاحقاً (عندما تكون جاهزاً)

أضف هذه القيم في Supabase ← Edge Functions ← Secrets:

| السر | القيمة |
|---|---|
| `PAYMENTS_MODE` | `sandbox` للتجربة، ثم `live` عند التشغيل الفعلي |
| `PAYMOB_SECRET_KEY` / `PAYMOB_PUBLIC_KEY` | من لوحة Paymob ← Settings |
| `PAYMOB_HMAC_SECRET` | من لوحة Paymob ← Settings |
| `PAYMOB_INTEGRATION_CARD` / `_WALLET` / `_VALU` | أرقام الـ Integration IDs |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | من Stripe (للدفع الدولي) |
| `INSTAPAY_ADDRESS` | عنوان إنستاباي (مثل `name@instapay`) |
| `SANDBOX_ALLOWED_PHONES` | أرقام موبايل تقدر تجرب الدفع في وضع sandbox |

- رابط Paymob callback: `https://gyeqbsoqmghxxnnfjizd.supabase.co/functions/v1/paymob-webhook`
- رابط Stripe webhook: `https://gyeqbsoqmghxxnnfjizd.supabase.co/functions/v1/stripe-webhook`
- التحويل البنكي يظهر تلقائياً عند كتابة رقم حساب حقيقي في الإعدادات (الأصفار الحالية لا تُفعّله).
- وضع `live` يرفض مفاتيح التجربة تلقائياً، ووضع `sandbox` يرفض المفاتيح الحقيقية.
