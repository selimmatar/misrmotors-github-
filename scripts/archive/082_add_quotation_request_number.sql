-- Add quotation_request_number to sales_orders table
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS quotation_request_number VARCHAR(100);

COMMENT ON COLUMN sales_orders.quotation_request_number IS 'Customer quotation request reference number';
