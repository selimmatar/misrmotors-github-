-- Add warehouse allocation to delivery permit items
-- This allows warehouse team to specify which warehouse items will be shipped from

-- Add warehouse_id column to delivery_permit_items
ALTER TABLE delivery_permit_items
ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(warehouse_id);

-- Add warehouse allocation columns
ALTER TABLE delivery_permit_items
ADD COLUMN IF NOT EXISTS allocated_quantity NUMERIC DEFAULT 0;

ALTER TABLE delivery_permit_items
ADD COLUMN IF NOT EXISTS allocation_notes TEXT;

-- Add READY_FOR_SHIPMENT status to delivery_permits
-- Update status check constraint to include new status
ALTER TABLE delivery_permits DROP CONSTRAINT IF EXISTS delivery_permits_status_check;
ALTER TABLE delivery_permits ADD CONSTRAINT delivery_permits_status_check 
  CHECK (status IN ('DRAFT', 'READY_FOR_SHIPMENT', 'PRINTED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED'));

-- Add columns for warehouse preparation
ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS prepared_by INTEGER REFERENCES users(user_id);

ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS prepared_at TIMESTAMP;

ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS preparation_notes TEXT;

-- Create index for faster warehouse lookups
CREATE INDEX IF NOT EXISTS idx_delivery_permit_items_warehouse ON delivery_permit_items(warehouse_id);

-- Verify changes
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'delivery_permit_items' 
AND column_name IN ('warehouse_id', 'allocated_quantity', 'allocation_notes');

SELECT 'Migration completed: Added warehouse allocation to delivery permit items' as status;
