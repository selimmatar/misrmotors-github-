-- Delivery Permits System v2
-- Run this migration to create the delivery permits workflow tables

-- Drop existing tables if they exist (clean slate)
DROP TABLE IF EXISTS delivery_permit_files CASCADE;
DROP TABLE IF EXISTS delivery_permit_items CASCADE;
DROP TABLE IF EXISTS delivery_permits CASCADE;
DROP TABLE IF EXISTS workflow_events CASCADE;

-- Create delivery_permits table
CREATE TABLE delivery_permits (
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

-- Create delivery_permit_items table
CREATE TABLE delivery_permit_items (
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

-- Create delivery_permit_files table
CREATE TABLE delivery_permit_files (
  file_id SERIAL PRIMARY KEY,
  permit_id INTEGER NOT NULL REFERENCES delivery_permits(permit_id) ON DELETE CASCADE,
  file_type VARCHAR(50) NOT NULL DEFAULT 'SIGNED_PERMIT' CHECK (file_type IN ('SIGNED_PERMIT', 'OTHER')),
  file_url TEXT NOT NULL,
  file_name VARCHAR(255),
  uploaded_by INTEGER REFERENCES users(user_id),
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

-- Create workflow_events table
CREATE TABLE workflow_events (
  event_id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  old_value TEXT,
  new_value TEXT,
  performed_by INTEGER REFERENCES users(user_id),
  performed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes TEXT,
  metadata JSONB
);

-- Add columns to sales_orders if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_orders' AND column_name = 'fulfillment_status') THEN
    ALTER TABLE sales_orders ADD COLUMN fulfillment_status VARCHAR(50) DEFAULT 'PENDING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_orders' AND column_name = 'payment_active') THEN
    ALTER TABLE sales_orders ADD COLUMN payment_active BOOLEAN DEFAULT FALSE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'sales_orders' AND column_name = 'payment_activated_at') THEN
    ALTER TABLE sales_orders ADD COLUMN payment_activated_at TIMESTAMP;
  END IF;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_delivery_permits_so_id ON delivery_permits(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_status ON delivery_permits(status);
CREATE INDEX IF NOT EXISTS idx_delivery_permits_customer_id ON delivery_permits(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permit_items_permit_id ON delivery_permit_items(permit_id);
CREATE INDEX IF NOT EXISTS idx_delivery_permit_files_permit_id ON delivery_permit_files(permit_id);
CREATE INDEX IF NOT EXISTS idx_workflow_events_entity ON workflow_events(entity_type, entity_id);

-- Enable RLS
ALTER TABLE delivery_permits ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_permit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_permit_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for delivery_permits
DROP POLICY IF EXISTS "Allow all operations on delivery_permits" ON delivery_permits;
CREATE POLICY "Allow all operations on delivery_permits" ON delivery_permits FOR ALL USING (true) WITH CHECK (true);

-- Create RLS policies for delivery_permit_items  
DROP POLICY IF EXISTS "Allow all operations on delivery_permit_items" ON delivery_permit_items;
CREATE POLICY "Allow all operations on delivery_permit_items" ON delivery_permit_items FOR ALL USING (true) WITH CHECK (true);

-- Create RLS policies for delivery_permit_files
DROP POLICY IF EXISTS "Allow all operations on delivery_permit_files" ON delivery_permit_files;
CREATE POLICY "Allow all operations on delivery_permit_files" ON delivery_permit_files FOR ALL USING (true) WITH CHECK (true);

-- Create RLS policies for workflow_events
DROP POLICY IF EXISTS "Allow all operations on workflow_events" ON workflow_events;
CREATE POLICY "Allow all operations on workflow_events" ON workflow_events FOR ALL USING (true) WITH CHECK (true);

-- Verify tables were created
SELECT 'delivery_permits created' AS status WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_permits');
SELECT 'delivery_permit_items created' AS status WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_permit_items');
SELECT 'delivery_permit_files created' AS status WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'delivery_permit_files');
SELECT 'workflow_events created' AS status WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'workflow_events');
