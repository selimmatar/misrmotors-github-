-- The customer's purchase order number for a sales order (owner request 2026-11-25). Optional: typed when the
-- quotation is approved into a sales order, or later by the accountant in the invoice's e-invoice window.
-- When set, it is sent to the tax portal as the invoice's purchaseOrderReference. Nothing else changes.
ALTER TABLE public.sales_orders ADD COLUMN IF NOT EXISTS customer_po text;
