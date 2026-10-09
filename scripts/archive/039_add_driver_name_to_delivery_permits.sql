-- Add driver_name column to delivery_permits table
ALTER TABLE delivery_permits 
ADD COLUMN IF NOT EXISTS driver_name character varying(255);

-- Add comment
COMMENT ON COLUMN delivery_permits.driver_name IS 'Name of the delivery driver assigned to this permit';
