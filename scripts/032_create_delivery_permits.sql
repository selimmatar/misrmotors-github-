-- Delivery Permits System
-- This migration creates the tables needed for the delivery permit workflow

-- Create delivery_permits table
CREATE TABLE IF NOT EXISTS delivery_permits (
  permit_id SERIAL PRIMARY KEY,
  permit_no VARCHAR(50) UNIQUE NOT NULL,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(so_id) ON DELETE CASCADE,
  customer_id INTEGER REFERENCES customers(customer_id),
  recipient_name VARCHAR(255),
  recipient_phone VARCHAR(50),
  delivery_address TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PRINTED', 'OUT_FOR_DELIVERY', 'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED')),
  rejection_reason TEXT,
  printed_at TIMESTAMP,
  printed_by INTEGER REFERENCES users(user_id),
  out_for_delivery_at TIMESTAMP,
  out_for_delivery_by INTEGER REFERENCES users(user_id),
  submitted_signed_at TIMESTAMP,
  submitted_signed_by INTEGER REFERENCES users(user_id),
  approved_at TIMESTAMP,
  approved_by INTEGER REFERENCES users(user_id),
  rejected_at TIMESTAMP,
  rejected_by INTEGER REFERENCES users(user_id),
  created_by INTEGER REFERENCES users(user_id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT unique_so_permit UNIQUE (sales_order_id)
);

-- Create delivery_permit_items table (snapshot of SO items at time of permit creation)
CREATE TABLE IF NOT EXISTS delivery_permit_items (
  item_id SERIAL PRIMARY KEY,
  permit_id INTEGER NOT NULL REFERENCES delivery_permits(permit_id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(product_id),
  item_name_snapshot VARCHAR(255) NOT NULL,
  sku_snapshot VARCHAR(100),
  unit_snapshot VARCHAR(50),
  quantity NUMERIC NOT NULL,
  unit_price NUMERIC,
  total NUMERIC,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create delivery_permit_files table (for uploaded signed permits)
CREATE TABLE IF NOT EXISTS delivery_permit_files (
  file_id SERIAL PRIMARY KEY,
  permit_id INTEGER NOT NULL REFERENCES delivery_permits(permit_id) ON DELETE CASCADE,
  file_type VARCHAR(50) NOT NULL DEFAULT 'SIGNED_PERMIT' CHECK (file_type IN ('SIGNED_PERMIT', 'OTHER')),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  uploaded_by INTEGER REFERENCES users(user_id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

-- Create workflow_events table for audit logging
CREATE TABLE IF NOT EXISTS workflow_events (
  event_id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL, -- 'DELIVERY_PERMIT', 'SALES_ORDER', etc.
  entity_id INTEGER NOT NULL,
  event_type VARCHAR(100) NOT NULL, -- 'STATUS_CHANGED', 'FILE_UPLOADED', etc.
  old_value TEXT,
  new_value TEXT,
  performed_by INTEGER REFERENCES users(user_id),
  performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  metadata JSONB
);

-- Add fulfillment_status to sales_orders if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_orders' AND column_name = 'fulfillment_status'
  ) THEN
    ALTER TABLE sales_orders ADD COLUMN fulfillment_status VARCHAR(50) DEFAULT 'PENDING';
  END IF;
END $$;

-- Add payment_active flag to sales_orders to control when payment plan starts
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_orders' AND column_name = 'payment_active'
  ) THEN
    ALTER TABLE sales_orders ADD COLUMN payment_active BOOLEAN DEFAULT FALSE;
  END IF;
END $$;

-- Add payment_activated_at timestamp
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'sales_orders' AND column_name = 'payment_activated_at'
  ) THEN
    ALTER TABLE sales_orders ADD COLUMN payment_activated_at TIMESTAMP;
  END IF;
END $$;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_delivery_permits_so_id ON delivery_permits(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_status ON delivery_permits(status);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_customer_id ON delivery_permits(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permit_items_permit_id ON delivery_permit_items(permit_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permit_files_permit_id ON delivery_permit_files(permit_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_entity ON workflow_events(entity_type, entity_id);

-- Update existing sales orders to have fulfillment_status based on current status
UPDATE sales_orders 
SET fulfillment_status = CASE 
  WHEN status IN ('shipped', 'delivered') THEN 'CONFIRMED'
  WHEN status = 'ready_for_delivery' THEN 'OUT_FOR_DELIVERY'
  ELSE 'PENDING'
END
WHERE fulfillment_status IS NULL OR fulfillment_status = 'PENDING';

-- Set payment_active to true for already shipped/delivered orders
UPDATE sales_orders 
SET payment_active = TRUE, payment_activated_at = COALESCE(shipped_at, created_at)
WHERE status IN ('shipped', 'delivered') AND payment_active IS NULL;
