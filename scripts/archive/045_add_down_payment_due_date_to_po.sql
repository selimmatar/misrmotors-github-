-- Add down_payment_due_date column to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS down_payment_due_date DATE;

-- Comment
COMMENT ON COLUMN purchase_orders.down_payment_due_date IS 'Due date for the down payment in hybrid payment orders';
