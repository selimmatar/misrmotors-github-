-- Add columns to track when product prices were last updated
-- This helps the pricing review module know which products still need price updates

-- Add price tracking columns to products table
ALTER TABLE products 
ADD COLUMN IF NOT EXISTS price_updated_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS price_updated_by INTEGER REFERENCES users(user_id),
ADD COLUMN IF NOT EXISTS last_landed_cost DECIMAL(12, 2);

-- Add index for efficient querying
CREATE INDEX IF NOT EXISTS idx_products_price_updated_at ON products(price_updated_at);

-- Comment on columns
COMMENT ON COLUMN products.price_updated_at IS 'Timestamp when the product price was last updated through pricing review';
COMMENT ON COLUMN products.price_updated_by IS 'User who last updated the product price';
COMMENT ON COLUMN products.last_landed_cost IS 'The landed cost used to calculate the current price';
