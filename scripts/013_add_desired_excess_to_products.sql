-- Add desired_excess column to products table for low stock suggestions
ALTER TABLE products
ADD COLUMN IF NOT EXISTS desired_excess INTEGER DEFAULT 0;

-- Update existing products to have a default desired_excess of 0
UPDATE products
SET desired_excess = 0
WHERE desired_excess IS NULL;
