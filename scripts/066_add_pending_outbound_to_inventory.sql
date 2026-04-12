-- Add pending_outbound column to inventory table
-- This tracks quantity allocated to delivery permits that haven't been delivered yet

ALTER TABLE inventory 
ADD COLUMN IF NOT EXISTS pending_outbound INTEGER DEFAULT 0 CHECK (pending_outbound >= 0);

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_inventory_pending_outbound ON inventory(pending_outbound) WHERE pending_outbound > 0;

-- Update comment
COMMENT ON COLUMN inventory.pending_outbound IS 'Quantity allocated to delivery permits awaiting delivery';
