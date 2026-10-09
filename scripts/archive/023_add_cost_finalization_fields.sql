-- Add cost finalization fields to purchase_orders table
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS tax_amount numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS other_costs numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_finalized boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS cost_finalized_at timestamp,
ADD COLUMN IF NOT EXISTS cost_finalized_by integer;

-- Add cost breakdown fields to purchase_order_items table
ALTER TABLE purchase_order_items
ADD COLUMN IF NOT EXISTS allocated_tax numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS allocated_overhead numeric(12,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS landed_cost numeric(12,2) DEFAULT 0;

-- Add pricing fields to products table
ALTER TABLE products
ADD COLUMN IF NOT EXISTS last_landed_cost numeric(12,2),
ADD COLUMN IF NOT EXISTS markup_percentage numeric(5,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS cost_updated_at timestamp,
ADD COLUMN IF NOT EXISTS cost_updated_by integer;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_po_cost_finalized ON purchase_orders(cost_finalized);
CREATE INDEX IF NOT EXISTS idx_products_cost_updated ON products(cost_updated_at DESC);
