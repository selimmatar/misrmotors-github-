-- Goods Receipt Tables for Partial Receipts, Discrepancies, and Multi-Warehouse Allocation
-- Additive Only - No breaking changes to existing purchase_orders or inventory tables

-- Create GRN (Goods Receipt Note) sequence
CREATE SEQUENCE IF NOT EXISTS grn_sequence START WITH 1;

-- Main goods receipts table
CREATE TABLE IF NOT EXISTS goods_receipts (
  receipt_id SERIAL PRIMARY KEY,
  grn_number VARCHAR(50) UNIQUE NOT NULL,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(po_id) ON DELETE RESTRICT,
  po_number VARCHAR(50),
  receipt_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' 
    CHECK (status IN ('pending', 'partial', 'complete', 'discrepancy')),
  received_by INTEGER REFERENCES users(user_id),
  notes TEXT,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Goods receipt line items (per-product tracking)
CREATE TABLE IF NOT EXISTS goods_receipt_lines (
  line_id SERIAL PRIMARY KEY,
  receipt_id INTEGER NOT NULL REFERENCES goods_receipts(receipt_id) ON DELETE CASCADE,
  po_item_id INTEGER REFERENCES purchase_order_items(po_item_id) ON DELETE SET NULL,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
  product_name VARCHAR(255),  -- Snapshot for historical records
  sku VARCHAR(50),            -- Snapshot
  quantity_ordered INTEGER NOT NULL,
  quantity_received INTEGER NOT NULL DEFAULT 0,
  quantity_remaining INTEGER GENERATED ALWAYS AS (quantity_ordered - quantity_received) STORED,
  discrepancy_type VARCHAR(30) 
    CHECK (discrepancy_type IN (NULL, 'missing', 'damaged', 'wrong_item', 'quantity_mismatch', 'other')),
  discrepancy_notes TEXT,
  warehouse_id INTEGER REFERENCES warehouses(warehouse_id),  -- Per-line warehouse assignment
  unit_cost NUMERIC(12,2),
  received_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Add new PO statuses (backward compatible enhancement)
ALTER TABLE purchase_orders 
DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders 
ADD CONSTRAINT purchase_orders_status_check 
CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'received', 'partially_received', 'received_with_issues'));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_goods_receipts_po_id ON goods_receipts(po_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_status ON goods_receipts(status);
CREATE INDEX IF NOT EXISTS idx_goods_receipts_date ON goods_receipts(receipt_date);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_receipt_id ON goods_receipt_lines(receipt_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_product_id ON goods_receipt_lines(product_id);
CREATE INDEX IF NOT EXISTS idx_goods_receipt_lines_warehouse_id ON goods_receipt_lines(warehouse_id);

-- Comments
COMMENT ON TABLE goods_receipts IS 'Tracks goods receipt events for purchase orders, supporting partial receipts and discrepancies';
COMMENT ON TABLE goods_receipt_lines IS 'Line-item details for goods receipts with per-line warehouse allocation';
COMMENT ON COLUMN goods_receipt_lines.quantity_remaining IS 'Auto-calculated: ordered - received';
COMMENT ON COLUMN goods_receipt_lines.warehouse_id IS 'Destination warehouse for this specific line item';

-- Function to generate GRN numbers
CREATE OR REPLACE FUNCTION generate_grn_number() RETURNS VARCHAR AS $$
DECLARE
  next_num INTEGER;
  year_str VARCHAR(4);
  grn_num VARCHAR(50);
BEGIN
  SELECT EXTRACT(YEAR FROM CURRENT_DATE)::VARCHAR INTO year_str;
  SELECT nextval('grn_sequence') INTO next_num;
  grn_num := 'GRN-' || year_str || '-' || LPAD(next_num::TEXT, 4, '0');
  RETURN grn_num;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate GRN number on insert
CREATE OR REPLACE FUNCTION set_grn_number() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.grn_number IS NULL OR NEW.grn_number = '' THEN
    NEW.grn_number := generate_grn_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_set_grn_number
  BEFORE INSERT ON goods_receipts
  FOR EACH ROW
  EXECUTE FUNCTION set_grn_number();

-- Verify tables created
SELECT 'Goods receipt tables created successfully' AS status;
SELECT COUNT(*) AS goods_receipts_count FROM goods_receipts;
SELECT COUNT(*) AS goods_receipt_lines_count FROM goods_receipt_lines;
