-- Add so_number and customer_name columns for direct display without lookups
ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS so_number VARCHAR(100);
ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
