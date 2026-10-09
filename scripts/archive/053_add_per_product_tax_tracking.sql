ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_tax_amount NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_other_costs NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS item_landed_cost NUMERIC(12, 2) DEFAULT 0;
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS tax_allocated_manually BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_po_items_tax_allocation ON purchase_order_items(po_id, tax_allocated_manually);
