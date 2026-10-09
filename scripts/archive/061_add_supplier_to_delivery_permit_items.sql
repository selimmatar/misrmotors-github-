-- Add supplier_id and outsourced_name columns to delivery_permit_items
-- This allows tracking which supplier is providing outsourced items

ALTER TABLE delivery_permit_items 
ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(supplier_id),
ADD COLUMN IF NOT EXISTS outsourced_name TEXT;

-- Add index for supplier lookups
CREATE INDEX IF NOT EXISTS idx_delivery_permit_items_supplier 
ON delivery_permit_items(supplier_id) WHERE supplier_id IS NOT NULL;

-- Update existing outsourced items with supplier info from sales order items
-- This backfills data for any existing delivery permits
UPDATE delivery_permit_items dpi
SET 
  supplier_id = soi.supplier_id,
  outsourced_name = soi.outsourced_name
FROM delivery_permits dp
JOIN sales_orders so ON dp.sales_order_id = so.so_id
JOIN sales_order_items soi ON so.so_id = soi.so_id
WHERE dpi.permit_id = dp.permit_id
  AND dpi.item_name_snapshot = soi.outsourced_name
  AND dpi.product_id IS NULL
  AND soi.item_type = 'outsourced';
