-- Add courier_name column to product_returns table
ALTER TABLE product_returns ADD COLUMN IF NOT EXISTS courier_name VARCHAR(255);
