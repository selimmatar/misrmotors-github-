-- Create couriers table
CREATE TABLE IF NOT EXISTS couriers (
  courier_id SERIAL PRIMARY KEY,
  courier_name VARCHAR(255) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  vehicle_type VARCHAR(100),
  vehicle_plate VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add courier_id to delivery_permits table
ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS courier_id INTEGER REFERENCES couriers(courier_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_delivery_permits_courier_id ON delivery_permits(courier_id);
CREATE INDEX IF NOT EXISTS idx_couriers_is_active ON couriers(is_active);
