-- Add is_outsourced flag and outsourced_name to inventory table for returned outsourced items
ALTER TABLE inventory
ADD COLUMN IF NOT EXISTS is_outsourced BOOLEAN DEFAULT FALSE;

ALTER TABLE inventory
ADD COLUMN IF NOT EXISTS outsourced_name TEXT;

ALTER TABLE inventory
ADD COLUMN IF NOT EXISTS outsourced_description TEXT;

-- Make product_id nullable to support outsourced items
ALTER TABLE inventory
ALTER COLUMN product_id DROP NOT NULL;

-- Add constraint: either product_id OR outsourced_name must be set
-- Comment out for now as existing records may violate this
-- ALTER TABLE inventory
-- ADD CONSTRAINT check_inventory_item_source
-- CHECK (product_id IS NOT NULL OR (is_outsourced = TRUE AND outsourced_name IS NOT NULL));

COMMENT ON COLUMN inventory.is_outsourced IS 'Flag indicating if this is an outsourced (non-product) item';
COMMENT ON COLUMN inventory.outsourced_name IS 'Name for outsourced items without a product_id';
