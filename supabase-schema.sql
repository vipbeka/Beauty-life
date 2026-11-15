-- ==========================================
-- BEAUTY LIFE — Database Schema (Supabase)
-- ==========================================

-- 1. Categories Table
CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    image_url TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Products Table
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL,
    old_price DECIMAL(12, 2),
    category_id TEXT REFERENCES categories(id) ON DELETE SET NULL,
    image_url TEXT,
    images JSONB DEFAULT '[]'::jsonb,
    stock INTEGER DEFAULT 0,
    badge TEXT,
    is_new BOOLEAN DEFAULT FALSE,
    is_featured BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    specs JSONB DEFAULT '{}'::jsonb,
    warranty TEXT,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Coupons Table
CREATE TABLE IF NOT EXISTS coupons (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    discount_type TEXT DEFAULT 'fixed', -- 'fixed' or 'percent'
    discount_value DECIMAL(12, 2) DEFAULT 0,
    min_order DECIMAL(12, 2) DEFAULT 0,
    max_uses INTEGER,
    used_count INTEGER DEFAULT 0,
    expires_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Orders Table
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT,
    customer_phone TEXT,
    customer_email TEXT,
    customer_address TEXT,
    city TEXT,
    subtotal DECIMAL(12, 2) DEFAULT 0,
    shipping_cost DECIMAL(12, 2) DEFAULT 0,
    discount DECIMAL(12, 2) DEFAULT 0,
    total DECIMAL(12, 2) DEFAULT 0,
    coupon_code TEXT,
    payment_method TEXT,
    status TEXT DEFAULT 'pending',
    payment_status TEXT DEFAULT 'unpaid',
    payment_provider TEXT,
    notes TEXT,
    shipping_type TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Order Items Table
CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,
    product_id TEXT,
    product_name TEXT,
    price DECIMAL(12, 2),
    quantity INTEGER DEFAULT 1,
    total DECIMAL(12, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Testimonials Table
CREATE TABLE IF NOT EXISTS testimonials (
    id TEXT PRIMARY KEY,
    name TEXT,
    city TEXT,
    rating INTEGER DEFAULT 5,
    text TEXT,
    product_id TEXT,
    order_number TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. Settings Table
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 8. Returns Table
CREATE TABLE IF NOT EXISTS returns (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    order_number TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    return_type TEXT DEFAULT 'refund',
    images JSONB DEFAULT '[]'::jsonb,
    timeline JSONB DEFAULT '[]'::jsonb,
    decision_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. Consultations Table
CREATE TABLE IF NOT EXISTS consultations (
    id TEXT PRIMARY KEY,
    name TEXT,
    phone TEXT,
    email TEXT,
    urgency TEXT DEFAULT 'normal',
    status TEXT DEFAULT 'new',
    message TEXT,
    admin_reply TEXT,
    admin_reply_at TIMESTAMPTZ,
    timeline JSONB DEFAULT '[]'::jsonb,
    decision_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Warranty Claims Table
CREATE TABLE IF NOT EXISTS warranty_claims (
    id TEXT PRIMARY KEY,
    order_id TEXT,
    order_number TEXT,
    product_id TEXT,
    status TEXT DEFAULT 'pending',
    issue TEXT,
    issue_type TEXT,
    description TEXT,
    images JSONB DEFAULT '[]'::jsonb,
    warranty_days INTEGER DEFAULT 365,
    warranty_expires_at TIMESTAMPTZ,
    timeline JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(order_number, product_id)
);

-- ==========================================
-- Storage Setup
-- ==========================================
-- ملاحظة: يجب تفعيل الـ Storage يدوياً من واجهة Supabase Bucket باسم 'beautylife'
-- أو تشغيل الكود التالي إذا كانت الصلاحيات تسمح:
INSERT INTO storage.buckets (id, name, public) 
VALUES ('beautylife', 'beautylife', true)
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- Enable Realtime
-- ==========================================
-- تفعيل البث المباشر للجداول الأساسية
ALTER PUBLICATION supabase_realtime ADD TABLE orders;
ALTER PUBLICATION supabase_realtime ADD TABLE products;
ALTER PUBLICATION supabase_realtime ADD TABLE categories;
ALTER PUBLICATION supabase_realtime ADD TABLE testimonials;
ALTER PUBLICATION supabase_realtime ADD TABLE coupons;
ALTER PUBLICATION supabase_realtime ADD TABLE returns;
ALTER PUBLICATION supabase_realtime ADD TABLE consultations;
ALTER PUBLICATION supabase_realtime ADD TABLE warranty_claims;
ALTER PUBLICATION supabase_realtime ADD TABLE settings;

-- ==========================================
-- Default Data (Optional)
-- ==========================================

-- Insert Default Categories
INSERT INTO categories (id, name, description, sort_order, is_active) VALUES
('cat_laser', 'أجهزة الليزر', 'أجهزة إزالة الشعر وتجديد البشرة بالليزر', 1, true),
('cat_hifu', 'أجهزة الهايفو', 'شد الوجه والجسم بتقنية HIFU', 2, true),
('cat_rf', 'أجهزة الترددات الراديوية', 'RF لشد البشرة وتحفيز الكولاجين', 3, true),
('cat_physio', 'أجهزة العلاج الطبيعي', 'أجهزة TENS و EMS والموجات فوق الصوتية', 4, true),
('cat_skin', 'أجهزة العناية بالبشرة', 'هيدرافيشل، ديرمابن، تحليل البشرة', 5, true),
('cat_slim', 'أجهزة تفتيت الدهون', 'كافيتيشن، كرايو، EMS Sculpt', 6, true)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;

-- Insert Default Settings
INSERT INTO settings (key, value) VALUES
('store', '{
  "storeName": "Beauty Life",
  "tagline": "أجهزة طبية للتجميل والعلاج الطبيعي",
  "phone": "+201000000000",
  "whatsapp": "201000000000",
  "email": "info@beautylife.com",
  "currency": "ج.م",
  "announcement": "شحن مجاني للطلبات فوق 5000 جنيه — ضمان سنتين على جميع الأجهزة"
}'::jsonb)
ON CONFLICT (key) DO NOTHING;
