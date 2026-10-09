-- Create warehouses table
CREATE TABLE IF NOT EXISTS warehouses (
  warehouse_id SERIAL PRIMARY KEY,
  warehouse_name VARCHAR(255) NOT NULL,
  location TEXT,
  address TEXT,
  contact_person VARCHAR(255),
  contact_phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add warehouse_id to inventory table
ALTER TABLE inventory ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(warehouse_id);

-- Add warehouse_id to inventory_batches table
ALTER TABLE inventory_batches ADD COLUMN IF NOT EXISTS warehouse_id INTEGER REFERENCES warehouses(warehouse_id);

-- Insert default warehouse
INSERT INTO warehouses (warehouse_name, location, is_default, is_active) 
VALUES ('Main Warehouse', 'Warehouse - Main', true, true)
ON CONFLICT DO NOTHING;

-- Update existing inventory items to use default warehouse
UPDATE inventory SET warehouse_id = (SELECT warehouse_id FROM warehouses WHERE is_default = true LIMIT 1) 
WHERE warehouse_id IS NULL;

-- Verify
SELECT * FROM warehouses;
