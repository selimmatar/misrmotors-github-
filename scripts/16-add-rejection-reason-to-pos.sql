-- Add rejection_reason column to purchase_orders table
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Add rejected_by column to track who rejected the PO
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS rejected_by INTEGER REFERENCES users(user_id);

-- Add rejected_at timestamp
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
