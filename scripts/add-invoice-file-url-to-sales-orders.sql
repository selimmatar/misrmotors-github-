-- Add invoice_file_url column to sales_orders table
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS invoice_file_url TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN sales_orders.invoice_file_url IS 'URL to the uploaded invoice file from Vercel Blob storage';
