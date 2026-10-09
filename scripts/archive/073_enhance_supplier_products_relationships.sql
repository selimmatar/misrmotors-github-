-- =============================================
-- Enhance supplier_products table for relationship management
-- Migration: 073
-- Purpose: Add priority ranking, notes, activity status, and order tracking
-- ADDITIVE ONLY - No breaking changes
-- =============================================

-- Add new columns to existing supplier_products table
ALTER TABLE supplier_products 
ADD COLUMN IF NOT EXISTS priority_rank INTEGER DEFAULT 999,
ADD COLUMN IF NOT EXISTS default_price NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS notes TEXT,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS last_order_date DATE,
ADD COLUMN IF NOT EXISTS times_ordered INTEGER DEFAULT 0;

-- Add comments for documentation
COMMENT ON COLUMN supplier_products.priority_rank IS 'Lower number = higher priority for suggestions (1=top priority)';
COMMENT ON COLUMN supplier_products.default_price IS 'Optional price override for this supplier-product combo';
COMMENT ON COLUMN supplier_products.notes IS 'Notes about this supplier-product relationship';
COMMENT ON COLUMN supplier_products.is_active IS 'Whether to show in suggestions (soft delete)';
COMMENT ON COLUMN supplier_products.last_order_date IS 'Last time this product was ordered from this supplier';
COMMENT ON COLUMN supplier_products.times_ordered IS 'Number of times ordered from this supplier';

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_supplier_products_priority 
  ON supplier_products(supplier_id, priority_rank) 
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_supplier_products_active 
  ON supplier_products(is_active) 
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_supplier_products_product_lookup 
  ON supplier_products(product_id) 
  WHERE is_active = TRUE;

-- Update existing rows to have default values
UPDATE supplier_products 
SET 
  priority_rank = COALESCE(priority_rank, 999),
  is_active = COALESCE(is_active, TRUE),
  times_ordered = COALESCE(times_ordered, 0)
WHERE priority_rank IS NULL OR is_active IS NULL OR times_ordered IS NULL;

-- Create a trigger to update times_ordered when POs are created
-- (This will be implemented in application logic for now)

COMMIT;
