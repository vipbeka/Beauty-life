-- =====================================================================
-- Beauty Life — إصلاح الطلبات: حفظ اسم الجهاز/نوعه + العنوان كامل
-- شغّل الملف ده مرة واحدة في: Supabase Dashboard > SQL Editor > New query
-- =====================================================================

-- 1) الأعمدة الناقصة في جدول الطلبات (دي السبب الأساسي للمشكلة)
alter table public.orders
  add column if not exists items         jsonb default '[]'::jsonb,
  add column if not exists address       text,
  add column if not exists governorate   text,
  add column if not exists country       text,
  add column if not exists shipping_fee  numeric(12,2) default 0,
  add column if not exists admin_notes   text;

-- 2) عمود تفاصيل إضافية للأصناف (صورة المنتج + الضمان)
alter table public.order_items
  add column if not exists meta jsonb default '{}'::jsonb;

create index if not exists order_items_order_id_idx on public.order_items(order_id);

-- 3) توحيد الأعمدة القديمة مع الجديدة للطلبات الموجودة
update public.orders
   set address = coalesce(address, customer_address),
       shipping_fee = coalesce(shipping_fee, shipping_cost, 0)
 where address is null or shipping_fee is null;

-- 4) تعبئة عمود items للطلبات القديمة من جدول order_items
update public.orders o
   set items = s.items
  from (
    select order_id,
           jsonb_agg(jsonb_build_object(
             'id',        coalesce(product_id, id::text),
             'product_id', product_id,
             'name',      product_name,
             'price',     price,
             'qty',       quantity
           ) || coalesce(meta, '{}'::jsonb)) as items
      from public.order_items
     group by order_id
  ) s
 where o.id = s.order_id
   and (o.items is null or o.items = '[]'::jsonb);

-- 5) تأكيد صلاحيات الكتابة/القراءة على order_items (لو RLS مفعّل)
alter table public.order_items enable row level security;

drop policy if exists order_items_insert_public on public.order_items;
create policy order_items_insert_public on public.order_items
  for insert to anon, authenticated with check (true);

drop policy if exists order_items_select_public on public.order_items;
create policy order_items_select_public on public.order_items
  for select to anon, authenticated using (true);

drop policy if exists order_items_delete_public on public.order_items;
create policy order_items_delete_public on public.order_items
  for delete to anon, authenticated using (true);

-- 6) تفعيل Realtime للأصناف (اختياري بس مفيد للوحة التحكم)
do $$
begin
  begin
    alter publication supabase_realtime add table public.order_items;
  exception when duplicate_object then null;
  end;
end $$;
