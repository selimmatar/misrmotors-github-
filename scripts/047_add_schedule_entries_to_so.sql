-- Add schedule_entries and schedule_mode columns to sales_orders table
-- Similar to what we have in purchase_orders for hybrid payment custom schedules

ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS schedule_entries jsonb DEFAULT NULL,
ADD COLUMN IF NOT EXISTS schedule_mode character varying(20) DEFAULT 'AUTO',
ADD COLUMN IF NOT EXISTS down_payment_due_date date DEFAULT NULL;

COMMENT ON COLUMN sales_orders.schedule_entries IS 'JSON array of custom payment schedule entries for manual/hybrid payments';
COMMENT ON COLUMN sales_orders.schedule_mode IS 'AUTO for calculated schedules, MANUAL for custom entries';
COMMENT ON COLUMN sales_orders.down_payment_due_date IS 'Due date for hybrid payment down payment';
