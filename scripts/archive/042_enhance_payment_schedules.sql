-- Add schedule_mode and is_active columns to payment_schedules
-- ADDITIVE ONLY - no drops or renames

-- Add schedule_mode column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'payment_schedules' AND column_name = 'schedule_mode') THEN
        ALTER TABLE payment_schedules ADD COLUMN schedule_mode VARCHAR(20) DEFAULT 'LEGACY_MONTHLY';
    END IF;
END $$;

-- Add is_active column if not exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'payment_schedules' AND column_name = 'is_active') THEN
        ALTER TABLE payment_schedules ADD COLUMN is_active BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Add so_id column for linking to sales orders (before invoice creation)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'payment_schedules' AND column_name = 'so_id') THEN
        ALTER TABLE payment_schedules ADD COLUMN so_id INTEGER REFERENCES sales_orders(so_id);
    END IF;
END $$;

-- Add po_id column for linking to purchase orders (before invoice creation)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'payment_schedules' AND column_name = 'po_id') THEN
        ALTER TABLE payment_schedules ADD COLUMN po_id INTEGER REFERENCES purchase_orders(po_id);
    END IF;
END $$;

-- Add schedule_type to differentiate between AR and AP schedules
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'payment_schedules' AND column_name = 'schedule_type') THEN
        ALTER TABLE payment_schedules ADD COLUMN schedule_type VARCHAR(10) DEFAULT 'AR';
    END IF;
END $$;

-- Add is_down_payment flag
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'payment_schedules' AND column_name = 'is_down_payment') THEN
        ALTER TABLE payment_schedules ADD COLUMN is_down_payment BOOLEAN DEFAULT false;
    END IF;
END $$;

-- Create index for performance
CREATE INDEX IF NOT EXISTS idx_payment_schedules_so_id ON payment_schedules(so_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_po_id ON payment_schedules(po_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_is_active ON payment_schedules(is_active);

-- Update existing schedules to be active (legacy data)
UPDATE payment_schedules SET is_active = true, schedule_mode = 'LEGACY_MONTHLY' WHERE is_active IS NULL;
