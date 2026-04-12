-- Add approval_document_url column to sales_orders
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS approval_document_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN sales_orders.approval_document_url IS 'URL of the uploaded approval document when quotation is approved';
