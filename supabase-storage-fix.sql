
-- 1. التأكد من وجود الـ Bucket باسم beautylife وجعله عاماً (Public)
INSERT INTO storage.buckets (id, name, public)
VALUES ('beautylife', 'beautylife', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2. السماح للجميع (الزوار والأدمن) برفع الصور (لأغراض التطوير الحالية)
CREATE POLICY "Allow Public Upload"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'beautylife');

-- 3. السماح للجميع بقراءة الصور (ضروري لظهور صور المنتجات)
CREATE POLICY "Allow Public View"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'beautylife');

-- 4. السماح بالحذف والتحديث (للأدمن)
CREATE POLICY "Allow Public Update"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'beautylife');

CREATE POLICY "Allow Public Delete"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'beautylife');
