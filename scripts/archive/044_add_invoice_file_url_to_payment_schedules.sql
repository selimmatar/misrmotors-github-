-- Add invoice_file_url column to payment_schedules table
-- This column stores the URL of uploaded supplier invoices for each payment entry

ALTER TABLE payment_schedules
ADD COLUMN IF NOT EXISTS invoice_file_url TEXT;

-- Add comment for documentation
COMMENT ON COLUMN payment_schedules.invoice_file_url IS 'URL of the uploaded supplier invoice document for this payment entry';
