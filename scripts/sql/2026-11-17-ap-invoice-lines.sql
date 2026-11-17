-- Several supplier bills per purchase order ("Bill received items", owner request 2026-11-17).
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: one new table and two new nullable / defaulted
-- columns; no existing row is changed. Safe to run twice.
--
--   ap_invoice_lines                      the lines of each supplier bill (which PO line, how many, at what price).
--                                         A bill made before this has no lines and counts as billing its whole PO.
--   purchase_order_items.quantity_not_coming
--                                         quantity of a PO line the supplier will not deliver, marked when the PO is
--                                         closed; it is left out of every bill. 0 = everything is coming.
--   accounts_payable.supplier_invoice_number
--                                         the supplier's own invoice number typed on a bill (our number stays in
--                                         invoice_number: APINV-<po> for the closing bill, APINV-<po>-B<n> for the others).
--
-- Until this runs the app keeps working as before (one bill per PO, made at close; lib/po-bill.ts treats the missing
-- table as "no lines").

create table if not exists public.ap_invoice_lines (
  line_id serial primary key,
  ap_invoice_id int not null references public.accounts_payable(invoice_id) on delete cascade,
  po_item_id int references public.purchase_order_items(po_item_id),
  product_id int null,
  description text,
  quantity numeric not null,
  unit_price numeric not null,
  total numeric not null,
  created_at timestamptz default now()
);

create index if not exists ap_invoice_lines_ap_invoice_id_idx on public.ap_invoice_lines (ap_invoice_id);
create index if not exists ap_invoice_lines_po_item_id_idx on public.ap_invoice_lines (po_item_id);

-- Lock-down: server (service key) only, no policies
alter table public.ap_invoice_lines enable row level security;

alter table public.purchase_order_items add column if not exists quantity_not_coming numeric not null default 0;
alter table public.accounts_payable add column if not exists supplier_invoice_number text;

-- Check (read-only): the table exists with RLS on and no policies, and the two columns exist.
-- select relname, relrowsecurity from pg_class where relname = 'ap_invoice_lines';
-- select count(*) from pg_policies where tablename = 'ap_invoice_lines';  -- 0
-- select column_name from information_schema.columns
--   where table_schema = 'public' and ((table_name = 'purchase_order_items' and column_name = 'quantity_not_coming')
--      or (table_name = 'accounts_payable' and column_name = 'supplier_invoice_number'));  -- 2 rows
