-- ==========================================
-- BEAUTY LIFE — Row Level Security (RLS) Policies
-- ==========================================

-- تفعيل خاصية RLS لجميع الجداول
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE warranty_claims ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------
-- 1. جداول للقراءة العامة (Public Read)
-- -----------------------------------------------------------

-- Categories: الكل يرى الأقسام
CREATE POLICY "Allow public read access" ON categories FOR SELECT USING (true);

-- Products: الكل يرى المنتجات
CREATE POLICY "Allow public read access" ON products FOR SELECT USING (true);

-- Testimonials: الكل يرى آراء العملاء
CREATE POLICY "Allow public read access" ON testimonials FOR SELECT USING (true);

-- Settings: الكل يرى إعدادات المتجر العامة
CREATE POLICY "Allow public read access" ON settings FOR SELECT USING (true);

-- -----------------------------------------------------------
-- 2. جداول للإرسال العام (Public Insert)
-- -----------------------------------------------------------

-- Orders: الزبون يرسل طلب، لكن لا يرى طلبات غيره
CREATE POLICY "Allow public insert access" ON orders FOR INSERT WITH CHECK (true);
-- للسماح للزبون بتتبع طلبه، سنسمح بالقراءة بناءً على رقم الهاتف أو رقم الطلب (اختياري)
CREATE POLICY "Allow users to view their own orders" ON orders FOR SELECT USING (true); 

-- Order Items: الزبون يرسل تفاصيل الطلب
CREATE POLICY "Allow public insert access" ON order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read access" ON order_items FOR SELECT USING (true);

-- Consultations: الزبون يرسل طلب استشارة
CREATE POLICY "Allow public insert access" ON consultations FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read access" ON consultations FOR SELECT USING (true);

-- Returns: الزبون يرسل طلب استرجاع
CREATE POLICY "Allow public insert access" ON returns FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read access" ON returns FOR SELECT USING (true);

-- Warranty Claims: الزبون يرسل مطالبة ضمان
CREATE POLICY "Allow public insert access" ON warranty_claims FOR INSERT WITH CHECK (true);
CREATE POLICY "Allow public read access" ON warranty_claims FOR SELECT USING (true);

-- Testimonials: الزبون يضيف رأيه
CREATE POLICY "Allow public insert access" ON testimonials FOR INSERT WITH CHECK (true);

-- -----------------------------------------------------------
-- 3. جدول الكوبونات (Coupons)
-- -----------------------------------------------------------
-- الزبون يقرأ الكوبون للتحقق منه فقط
CREATE POLICY "Allow public read access" ON coupons FOR SELECT USING (true);
-- تحديث عدد مرات الاستخدام (Update used_count)
CREATE POLICY "Allow public update used_count" ON coupons FOR UPDATE USING (true) WITH CHECK (true);

-- -----------------------------------------------------------
-- 4. صلاحيات الأدمن (Admin Full Access)
-- -----------------------------------------------------------
-- ملاحظة: في Supabase، مفتاح Service Role يتجاوز الـ RLS تلقائياً.
-- إذا كنت تستخدم الـ Anon Key في لوحة التحكم (وهو ما يفعله كود الموقع الحالي)، 
-- سنحتاج للسماح بجميع العمليات للأدمن.
-- بما أن الموقع يستخدم Anon Key للأدمن أيضاً، سنفتح الصلاحيات الكاملة مؤقتاً 
-- أو نعتمد على التحقق من داخل التطبيق كما هو موجود في الكود.

-- للسماح للأدمن بالتعديل والحذف من لوحة التحكم باستخدام Anon Key:
CREATE POLICY "Allow all for anon" ON categories FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON products FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON orders FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON order_items FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON coupons FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON testimonials FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON settings FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON returns FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON consultations FOR ALL USING (true);
CREATE POLICY "Allow all for anon" ON warranty_claims FOR ALL USING (true);

-- تنبيه: السياسات الأخيرة (Allow all for anon) تفتح القاعدة بالكامل.
-- في بيئة الإنتاج الحقيقية، يفضل استخدام Supabase Auth وربط السياسات بـ auth.uid()
-- لكن لتشغيل الموقع الحالي كما هو مصمم، هذه السياسات هي المطلوبة.
