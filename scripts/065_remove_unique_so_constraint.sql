-- Remove the unique constraint that prevents multiple DPs per SO
-- This allows creating multiple delivery permits from one sales order

-- Drop the unique constraint
ALTER TABLE delivery_permits 
DROP CONSTRAINT IF EXISTS unique_so_permit;

-- Add comment explaining why multiple DPs per SO are allowed
COMMENT ON TABLE delivery_permits IS 'Multiple delivery permits can be created for a single sales order to handle partial deliveries';
