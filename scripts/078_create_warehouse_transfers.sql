-- Warehouse Transfers Table
-- Supports inter-warehouse stock transfers with approval workflow

-- Create transfer sequence for transfer numbers
CREATE SEQUENCE IF NOT EXISTS warehouse_transfer_sequence START WITH 1;

-- Main transfers table
CREATE TABLE IF NOT EXISTS warehouse_transfers (
  transfer_id SERIAL PRIMARY KEY,
  transfer_number VARCHAR(50) UNIQUE NOT NULL,
  source_warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  destination_warehouse_id INTEGER NOT NULL REFERENCES warehouses(warehouse_id),
  status VARCHAR(30) NOT NULL DEFAULT 'draft' 
    CHECK (status IN ('draft', 'pending', 'approved', 'in_transit', 'completed', 'cancelled')),
  requested_by INTEGER REFERENCES users(user_id),
  approved_by INTEGER REFERENCES users(user_id),
  completed_by INTEGER REFERENCES users(user_id),
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  approval_date DATE,
  completion_date DATE,
  notes TEXT,
  rejection_reason TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  
  -- Ensure source and destination are different
  CONSTRAINT different_warehouses CHECK (source_warehouse_id != destination_warehouse_id)
);

-- Transfer line items
CREATE TABLE IF NOT EXISTS warehouse_transfer_items (
  item_id SERIAL PRIMARY KEY,
  transfer_id INTEGER NOT NULL REFERENCES warehouse_transfers(transfer_id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  product_name VARCHAR(255),  -- Snapshot for historical records
  sku VARCHAR(50),            -- Snapshot
  quantity_requested INTEGER NOT NULL CHECK (quantity_requested > 0),
  quantity_sent INTEGER DEFAULT 0,
  quantity_received INTEGER DEFAULT 0,
  unit_cost NUMERIC(12,2),    -- Cost at time of transfer
  notes TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_source ON warehouse_transfers(source_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_dest ON warehouse_transfers(destination_warehouse_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_status ON warehouse_transfers(status);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfers_date ON warehouse_transfers(request_date);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_transfer ON warehouse_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS idx_warehouse_transfer_items_product ON warehouse_transfer_items(product_id);

-- Function to generate transfer numbers
CREATE OR REPLACE FUNCTION generate_transfer_number() RETURNS VARCHAR AS $$
DECLARE
  next_num INTEGER;
  year_str VARCHAR(4);
  transfer_num VARCHAR(50);
BEGIN
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::VARCHAR INTO year_str;
  SELECT nextval('warehouse_transfer_sequence') INTO next_num;
  transfer_num := 'TRF-' || year_str || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN transfer_num;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate transfer number on insert
CREATE OR REPLACE FUNCTION set_transfer_number() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.transfer_number IS NULL OR NEW.transfer_number = '' THEN
    NEW.transfer_number := generate_transfer_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_transfer_number ON warehouse_transfers;
CREATE TRIGGER trigger_set_transfer_number
  BEFORE INSERT ON warehouse_transfers
  FOR EACH ROW
  EXECUTE FUNCTION set_transfer_number();

-- Comments
COMMENT ON TABLE warehouse_transfers IS 'Tracks inter-warehouse stock transfer requests with approval workflow';
COMMENT ON TABLE warehouse_transfer_items IS 'Line items for warehouse transfers with quantity tracking';
COMMENT ON COLUMN warehouse_transfers.status IS 'draft=created, pending=awaiting approval, approved=ready to ship, in_transit=being transferred, completed=received at destination, cancelled=cancelled';

-- Verify tables created
SELECT 'Warehouse transfer tables created successfully' AS status;
