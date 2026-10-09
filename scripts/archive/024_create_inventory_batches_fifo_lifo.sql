-- Create Inventory Batches table to track cost layers
CREATE TABLE IF NOT EXISTS inventory_batches (
  batch_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  po_id INTEGER REFERENCES purchase_orders(po_id) ON DELETE SET NULL,
  po_number VARCHAR(50),
  quantity_received INTEGER NOT NULL,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  unit_cost NUMERIC(12, 2) NOT NULL,
  landed_cost_per_unit NUMERIC(12, 2),
  received_date DATE NOT NULL,
  batch_sequence INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create Inventory Allocations table to track which batch was used for sales
CREATE TABLE IF NOT EXISTS inventory_allocations (
  allocation_id SERIAL PRIMARY KEY,
  sales_order_item_id INTEGER NOT NULL,
  so_id INTEGER NOT NULL REFERENCES sales_orders(so_id) ON DELETE CASCADE,
  batch_id INTEGER NOT NULL REFERENCES inventory_batches(batch_id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  quantity_allocated INTEGER NOT NULL,
  cost_per_unit NUMERIC(12, 2) NOT NULL,
  total_cogs NUMERIC(12, 2) NOT NULL,
  allocation_method VARCHAR(10) NOT NULL CHECK (allocation_method IN ('FIFO', 'LIFO')),
  allocated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_batches_product ON inventory_batches(product_id);
CREATE INDEX IF NOT EXISTS idx_batches_po ON inventory_batches(po_id);
CREATE INDEX IF NOT EXISTS idx_batches_available ON inventory_batches(product_id, quantity_available) WHERE quantity_available > 0;
CREATE INDEX IF NOT EXISTS idx_allocations_so_item ON inventory_allocations(sales_order_item_id);
CREATE INDEX IF NOT EXISTS idx_allocations_batch ON inventory_allocations(batch_id);
CREATE INDEX IF NOT EXISTS idx_allocations_so ON inventory_allocations(so_id);

-- Add company settings table to store FIFO/LIFO preference
CREATE TABLE IF NOT EXISTS company_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value TEXT NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_by INTEGER REFERENCES users(user_id)
);

-- Set default costing method to FIFO
INSERT INTO company_settings (setting_key, setting_value) 
VALUES ('inventory_costing_method', 'FIFO')
ON CONFLICT (setting_key) DO NOTHING;
