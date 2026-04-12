-- Add unit_cost column to inventory table
ALTER TABLE inventory 
ADD COLUMN IF NOT EXISTS unit_cost DECIMAL(10, 2) DEFAULT 0;

-- Update existing inventory with unit costs from products
UPDATE inventory 
SET unit_cost = products.unit_price
FROM products
WHERE inventory.product_id = products.product_id;
