-- Store the display name on each PO item so free-text items (no product_id)
-- still print correctly on purchase orders and supplier invoice PDFs
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_name_snapshot TEXT;

-- Backfill from the linked product where one exists
UPDATE purchase_order_items poi
SET item_name_snapshot = p.product_name
FROM products p
WHERE poi.product_id = p.product_id
  AND poi.item_name_snapshot IS NULL;
