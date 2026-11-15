-- ==========================================
-- BEAUTY LIFE — Database Performance Optimization
-- ==========================================

-- 1. تحسين سرعة البحث والترتيب في جدول الطلبات (Orders)
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders (order_number);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON orders (customer_phone);

-- 2. تحسين سرعة عرض المنتجات حسب القسم والترتيب (Products)
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products (sort_order);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_is_active ON products (is_active);

-- 3. تحسين سرعة الأقسام (Categories)
CREATE INDEX IF NOT EXISTS idx_categories_sort_order ON categories (sort_order);

-- 4. تحسين سرعة الاستشارات (Consultations)
CREATE INDEX IF NOT EXISTS idx_consultations_created_at ON consultations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_consultations_status ON consultations (status);

-- 5. تحسين سرعة الاسترجاع والضمان (Returns & Warranty)
CREATE INDEX IF NOT EXISTS idx_returns_order_number ON returns (order_number);
CREATE INDEX IF NOT EXISTS idx_returns_created_at ON returns (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warranty_order_number ON warranty_claims (order_number);
CREATE INDEX IF NOT EXISTS idx_warranty_created_at ON warranty_claims (created_at DESC);

-- 6. تحسين أداء البحث النصي (اختياري - إذا كان هناك بحث بالاسم)
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin (name gin_trgm_ops) WHERE name IS NOT NULL;
-- ملاحظة: يتطلب تفعيل إضافة pg_trgm إذا لم تكن مفعلة:
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 7. تنظيف البيانات غير الضرورية (Vacuum)
-- هذا الأمر يساعد قاعدة البيانات على إعادة تنظيم نفسها (يفضل تشغيله يدوياً)
-- VACUUM ANALYZE;
