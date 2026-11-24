-- Delivery permits: "not received" read from the signed upload, and a signed upload sent back to shipping
-- (owner requests 2026-11-24; lib/dp-not-received.ts, lib/dp-transitions.ts SEND_BACK_TO_SHIPPING,
-- app/api/delivery-permits/route.ts, app/api/delivery-permits/not-received/route.ts).
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: new nullable / defaulted columns. Safe to run twice.
--
-- Until this runs the app keeps working:
--   * "re-upload needed" is derived from status OUT_FOR_DELIVERY + delivery_permits.rejection_reason (existing column),
--     and the reason is shown from rejection_reason; the writes to the columns below are best-effort and ignored when
--     a column is missing;
--   * the lines not received are recorded as returns (product_returns / return_items, the existing flow), so the
--     reprint, invoicing, the order overview and stock follow them; received_quantity is only a convenience copy.

alter table public.delivery_permits add column if not exists needs_reupload boolean not null default false;
alter table public.delivery_permits add column if not exists reupload_reason text;
alter table public.delivery_permits add column if not exists reupload_requested_at timestamptz;

alter table public.delivery_permit_items add column if not exists received_quantity numeric;

comment on column public.delivery_permits.needs_reupload is
  'True while the permit is back with shipping because its signed upload was wrong / unclear (SEND_BACK_TO_SHIPPING)';
comment on column public.delivery_permits.reupload_reason is
  'Why the signed upload was sent back to shipping (shown to the shipping team)';
comment on column public.delivery_permits.reupload_requested_at is
  'When the signed upload was last sent back to shipping';
comment on column public.delivery_permit_items.received_quantity is
  'Quantity the customer received, as confirmed from the signed permit ("الكمية المستلمة"); null = not recorded';
