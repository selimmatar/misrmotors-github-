-- FEATURE B: Support for Outsourced (Non-stock) Items in Sales Orders
-- Safe, backward-compatible migration with data preservation

-- Add item_type column with default 'stock' for all existing records
ALTER TABLE sales_order_items 
ADD COLUMN IF NOT EXISTS item_type TEXT DEFAULT 'stock';

-- Add outsourced item fields (all nullable for stock items)
ALTER TABLE sales_order_items 
ADD COLUMN IF NOT EXISTS outsourced_name TEXT,
ADD COLUMN IF NOT EXISTS outsourced_description TEXT,
ADD COLUMN IF NOT EXISTS outsourced_unit TEXT,
ADD COLUMN IF NOT EXISTS cost_estimate NUMERIC(12, 2),
ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL;

-- Backfill existing records to explicitly mark as 'stock' type
UPDATE sales_order_items SET item_type = 'stock' WHERE item_type IS NULL;

-- Add check constraint for item_type
ALTER TABLE sales_order_items 
DROP CONSTRAINT IF EXISTS check_item_type_valid;

ALTER TABLE sales_order_items 
ADD CONSTRAINT check_item_type_valid 
CHECK (item_type IN ('stock', 'outsourced'));

-- Add validation constraints
-- Stock items MUST have product_id, outsourced items MUST NOT
ALTER TABLE sales_order_items 
DROP CONSTRAINT IF EXISTS check_stock_has_product;

ALTER TABLE sales_order_items 
ADD CONSTRAINT check_stock_has_product 
CHECK (
  (item_type = 'stock' AND product_id IS NOT NULL) OR
  (item_type = 'outsourced' AND product_id IS NULL)
);

-- Outsourced items MUST have outsourced_name
ALTER TABLE sales_order_items 
DROP CONSTRAINT IF EXISTS check_outsourced_has_name;

ALTER TABLE sales_order_items 
ADD CONSTRAINT check_outsourced_has_name 
CHECK (
  (item_type = 'outsourced' AND outsourced_name IS NOT NULL AND outsourced_name <> '') OR
  (item_type = 'stock')
);

-- Make product_id nullable to support outsourced items
ALTER TABLE sales_order_items 
ALTER COLUMN product_id DROP NOT NULL;

-- Create index for filtering by item_type
CREATE INDEX IF NOT EXISTS idx_so_items_item_type ON sales_order_items(item_type);

-- Add comments for documentation
COMMENT ON COLUMN sales_order_items.item_type IS 'Type of item: stock (from inventory) or outsourced (non-stock)';
COMMENT ON COLUMN sales_order_items.outsourced_name IS 'Product name for outsourced items (required if item_type=outsourced)';
COMMENT ON COLUMN sales_order_items.outsourced_description IS 'Description for outsourced items';
COMMENT ON COLUMN sales_order_items.outsourced_unit IS 'Unit of measure for outsourced items (e.g., piece, meter, kg)';
COMMENT ON COLUMN sales_order_items.cost_estimate IS 'Estimated cost for procurement margin tracking (optional)';
COMMENT ON COLUMN sales_order_items.supplier_id IS 'Optional link to supplier for outsourced items';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON sales_order_items TO authenticated;
