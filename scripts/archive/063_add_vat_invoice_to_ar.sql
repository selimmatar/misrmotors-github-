-- Add VAT invoice URL field to accounts_receivable table
ALTER TABLE accounts_receivable
ADD COLUMN IF NOT EXISTS vat_invoice_url TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN accounts_receivable.vat_invoice_url IS 'URL to the uploaded VAT invoice PDF document';
