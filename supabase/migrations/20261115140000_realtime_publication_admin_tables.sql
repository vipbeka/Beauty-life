-- Applied 2026-11-15: the supabase_realtime publication was empty, so the admin panel's live
-- channel could never subscribe ("Realtime غير متصل"). RLS still applies: visitors receive nothing
-- from tables they cannot read (and the storefront no longer subscribes at all).
alter publication supabase_realtime add table
  public.orders, public.products, public.categories, public.testimonials, public.coupons,
  public.returns, public.consultations, public.warranty_claims, public.settings;
