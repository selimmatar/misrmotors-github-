-- Add lead_time_days column to suppliers table
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS lead_time_days INTEGER DEFAULT 7;

-- Add comment explaining the field
COMMENT ON COLUMN suppliers.lead_time_days IS 'Average lead time in days for orders from this supplier';
