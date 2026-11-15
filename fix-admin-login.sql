-- =====================================================================
-- BEAUTY LIFE — إصلاح تسجيل دخول الأدمن على السيرفر (Supabase) الجديد
-- المشروع: gyeqbsoqmghxxnnfjizd
-- شغّله من: Supabase Dashboard → SQL Editor → New query → Run
-- =====================================================================

-- الخطوة 0: تفعيل إضافة التشفير (لازمة لتشفير الباسورد)
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =====================================================================
-- الخطوة 1: شوف مين موجود أصلاً في المستخدمين
-- (لو الجدول طلع فاضي → ده سبب المشكلة: المستخدمين ما اتنقلوش مع الداتا)
-- =====================================================================
SELECT
  email,
  email_confirmed_at,
  created_at,
  CASE WHEN email_confirmed_at IS NULL
       THEN '❌ الإيميل غير مؤكد — الدخول هيفشل'
       ELSE '✅ مؤكد' END AS الحالة
FROM auth.users
ORDER BY created_at DESC;


-- =====================================================================
-- الخطوة 2: إنشاء حساب أدمن مؤكد
-- ⚠️ غيّر الإيميل والباسورد في السطرين اللي تحت قبل ما تشغّل
-- =====================================================================
DO $$
DECLARE
  v_email TEXT := 'beauty@admin.com';        -- 👈 غيّره
  v_pass  TEXT := ' beka1';    -- 👈 غيّره لباسورد قوي
  v_id    UUID;
BEGIN
  SELECT id INTO v_id FROM auth.users WHERE lower(email) = lower(v_email);

  IF v_id IS NULL THEN
    -- المستخدم مش موجود → أنشئه مؤكد على طول
    v_id := gen_random_uuid();

    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data,
      confirmation_token, recovery_token,
      email_change_token_new, email_change
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_id, 'authenticated', 'authenticated',
      lower(v_email),
      crypt(v_pass, gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{"role":"admin"}'::jsonb,
      '', '', '', ''
    );

    RAISE NOTICE 'تم إنشاء المستخدم: %', v_email;
  ELSE
    -- موجود → صفّر الباسورد وأكّد الإيميل
    UPDATE auth.users
       SET encrypted_password = crypt(v_pass, gen_salt('bf')),
           email_confirmed_at = COALESCE(email_confirmed_at, now()),
           updated_at         = now(),
           raw_user_meta_data = COALESCE(raw_user_meta_data,'{}'::jsonb) || '{"role":"admin"}'::jsonb,
           banned_until       = NULL
     WHERE id = v_id;

    RAISE NOTICE 'تم تحديث المستخدم الموجود: %', v_email;
  END IF;

  -- سطر الهوية (identity) — لازم لتسجيل الدخول بالباسورد في نسخ Supabase الحديثة
  IF NOT EXISTS (
    SELECT 1 FROM auth.identities
     WHERE user_id = v_id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, provider_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      gen_random_uuid(), v_id, v_id::text,
      jsonb_build_object('sub', v_id::text, 'email', lower(v_email), 'email_verified', true),
      'email', now(), now(), now()
    );
    RAISE NOTICE 'تم إنشاء سطر الهوية';
  END IF;
END $$;


-- =====================================================================
-- الخطوة 3: تأكيد أي مستخدم قديم إيميله مش مؤكد
-- =====================================================================
UPDATE auth.users
   SET email_confirmed_at = now(), updated_at = now()
 WHERE email_confirmed_at IS NULL;


-- =====================================================================
-- الخطوة 4: التحقق النهائي — لازم كل سطر يطلع ✅ في العمودين
-- =====================================================================
SELECT
  u.email,
  CASE WHEN u.email_confirmed_at IS NOT NULL THEN '✅' ELSE '❌' END AS إيميل_مؤكد,
  CASE WHEN i.id IS NOT NULL THEN '✅' ELSE '❌ ناقص identity' END AS الهوية,
  CASE WHEN u.banned_until IS NULL OR u.banned_until < now() THEN '✅' ELSE '❌ محظور' END AS غير_محظور
FROM auth.users u
LEFT JOIN auth.identities i
       ON i.user_id = u.id AND i.provider = 'email'
ORDER BY u.created_at DESC;
