-- Add discount fields to sales_orders table
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS discount_type VARCHAR(20) DEFAULT 'none',
ADD COLUMN IF NOT EXISTS discount_value NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS net_total NUMERIC(10,2);

-- Add constraint for discount_type
ALTER TABLE sales_orders
DROP CONSTRAINT IF EXISTS sales_orders_discount_type_check;

ALTER TABLE sales_orders
ADD CONSTRAINT sales_orders_discount_type_check 
CHECK (discount_type IN ('none', 'percentage', 'fixed'));

-- Update existing records to have proper values
UPDATE sales_orders
SET 
  subtotal = total,
  net_total = total,
  discount_type = 'none',
  discount_value = 0,
  discount_amount = 0
WHERE subtotal IS NULL;

-- Add comment
COMMENT ON COLUMN sales_orders.discount_type IS 'Type of discount: none, percentage, or fixed';
COMMENT ON COLUMN sales_orders.discount_value IS 'Discount value (percentage or fixed amount)';
COMMENT ON COLUMN sales_orders.discount_amount IS 'Calculated discount amount';
COMMENT ON COLUMN sales_orders.subtotal IS 'Sum of all line items before discount';
COMMENT ON COLUMN sales_orders.net_total IS 'Final total after discount (subtotal - discount_amount)';
