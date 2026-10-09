-- Add receipt_url column to supplier_payments table
ALTER TABLE supplier_payments 
ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN supplier_payments.receipt_url IS 'URL to uploaded payment receipt image';
