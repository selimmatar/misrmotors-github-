-- FEATURE B: Outsourced / non-stock items on Sales Orders
-- Extend sales_order_items table to support both stock and outsourced items

-- Add new columns
ALTER TABLE sales_order_items 
ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'stock' CHECK (item_type IN ('stock', 'outsourced'));

ALTER TABLE sales_order_items
ADD COLUMN IF NOT EXISTS outsourced_name TEXT,
ADD COLUMN IF NOT EXISTS outsourced_description TEXT,
ADD COLUMN IF NOT EXISTS outsourced_unit TEXT,
ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC(15,2);

-- Make product_id nullable (it's required only for stock items)
ALTER TABLE sales_order_items ALTER COLUMN product_id DROP NOT NULL;

-- Add validation constraint
ALTER TABLE sales_order_items
ADD CONSTRAINT chk_item_type_fields CHECK (
  (item_type = 'stock' AND product_id IS NOT NULL AND outsourced_name IS NULL)
  OR
  (item_type = 'outsourced' AND product_id IS NULL AND outsourced_name IS NOT NULL)
);

-- Create index for item type filtering
CREATE INDEX IF NOT EXISTS idx_so_items_type ON sales_order_items(item_type);

-- Update existing records to have item_type = 'stock'
UPDATE sales_order_items SET item_type = 'stock' WHERE item_type IS NULL;

COMMIT;
