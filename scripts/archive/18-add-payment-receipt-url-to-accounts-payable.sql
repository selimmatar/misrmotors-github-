-- Add payment_receipt_url column to accounts_payable table
-- Stores the receipt PDF uploaded when recording a full payment
ALTER TABLE accounts_payable
ADD COLUMN IF NOT EXISTS payment_receipt_url TEXT;

COMMENT ON COLUMN accounts_payable.payment_receipt_url IS 'URL to uploaded payment receipt PDF';
