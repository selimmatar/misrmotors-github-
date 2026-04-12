-- Add schedule_entries JSONB column to store custom payment schedule entries
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS schedule_entries JSONB;

-- Add schedule_mode to track AUTO vs MANUAL
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS schedule_mode VARCHAR(20) DEFAULT 'AUTO';

COMMENT ON COLUMN purchase_orders.schedule_entries IS 'Stores custom payment schedule entries for manual scheduling mode';
COMMENT ON COLUMN purchase_orders.schedule_mode IS 'AUTO = equal monthly installments, MANUAL = custom amounts/dates per installment';
