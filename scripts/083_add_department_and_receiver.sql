-- Add department_name and receiver_name fields to sales_orders table
ALTER TABLE sales_orders 
  ADD COLUMN IF NOT EXISTS department_name TEXT,
  ADD COLUMN IF NOT EXISTS receiver_name TEXT;

COMMIT;
