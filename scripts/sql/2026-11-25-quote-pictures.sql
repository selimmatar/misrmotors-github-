-- Quotations with pictures (owner request 2026-11-24): each quotation line may carry one picture, printed as a small
-- thumbnail on the quotation (lib/quotations/line-picture.ts, app/api/sales-quotations/route.ts,
-- app/api/quotations/generate/route.ts). The picture is a public Vercel Blob URL uploaded from the quotation form
-- (/api/upload), or the product's own saved picture when "With picture" is ticked.
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: one new nullable column. Safe to run twice.
--
-- Product pictures need no change: they already live in public.product_images (product_id, image_url, created_at;
-- scripts/archive/031_add_product_images.sql). The products table itself has no picture column, and none is added.
--
-- Until this runs the app keeps working: a quotation is saved without its pictures and the form says so
-- ("pictures not saved"); prints made from the form still show the pictures it holds.

alter table public.sales_quotation_items add column if not exists image_url text;

comment on column public.sales_quotation_items.image_url is
  'Picture printed beside this quotation line (Vercel Blob URL); null = no picture';
