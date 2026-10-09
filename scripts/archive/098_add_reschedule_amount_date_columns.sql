-- Add missing columns to reschedule_requests table
ALTER TABLE reschedule_requests
ADD COLUMN IF NOT EXISTS current_amount NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS requested_amount NUMERIC(15, 2),
ADD COLUMN IF NOT EXISTS current_due_date DATE,
ADD COLUMN IF NOT EXISTS requested_due_date DATE;

-- Add comments
COMMENT ON COLUMN reschedule_requests.current_amount IS 'Current invoice amount';
COMMENT ON COLUMN reschedule_requests.requested_amount IS 'Requested new invoice amount';
COMMENT ON COLUMN reschedule_requests.current_due_date IS 'Current invoice due date';
COMMENT ON COLUMN reschedule_requests.requested_due_date IS 'Requested new due date';
