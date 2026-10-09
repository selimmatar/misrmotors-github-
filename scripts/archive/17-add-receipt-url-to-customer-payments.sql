-- Add receipt_url column to customer_payments table
ALTER TABLE customer_payments 
ADD COLUMN IF NOT EXISTS receipt_url TEXT;
