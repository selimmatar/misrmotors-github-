-- A quotation line taken from free stored stock (owner report 2026-11-18): "Add from inventory" on a new quotation
-- offers free stored outsourced items (customer returns put into a warehouse) like the sales order form does. The
-- line remembers the inventory row it was picked from; approving the quotation reserves that row for the new sales
-- order (lib/quotations/from-stock.ts, app/api/sales-quotations/approve/route.ts).
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: one new nullable column. Safe to run twice.
--
-- Until this runs the app keeps working: such a line is saved as a plain outsourced line (name, stock cost, supplier)
-- and approving the quotation reserves nothing for it.

alter table public.sales_quotation_items add column if not exists from_inventory_id int;
