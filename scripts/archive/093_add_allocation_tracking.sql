-- Add allocation tracking columns to delivery_permits

ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS allocated_at TIMESTAMP;

ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS allocated_by INTEGER REFERENCES users(user_id);

-- Verify
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'delivery_permits' 
AND column_name IN ('allocated_at', 'allocated_by');

SELECT 'Migration completed: Added allocation tracking columns' as status;
