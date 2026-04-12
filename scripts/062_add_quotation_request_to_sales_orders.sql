-- Add quotation request fields to sales_orders table
-- Idempotent: safe to run multiple times

-- Create sequence for atomic QR number generation
CREATE SEQUENCE IF NOT EXISTS quotation_request_number_seq START WITH 1;

-- Add columns to sales_orders table
ALTER TABLE sales_orders 
  ADD COLUMN IF NOT EXISTS quotation_request_number VARCHAR(50) UNIQUE,
  ADD COLUMN IF NOT EXISTS quotation_request_file_path TEXT,
  ADD COLUMN IF NOT EXISTS quotation_request_file_name TEXT,
  ADD COLUMN IF NOT EXISTS quotation_request_mime_type VARCHAR(100),
  ADD COLUMN IF NOT EXISTS quotation_request_uploaded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS quotation_request_uploaded_by VARCHAR(255);

-- Add index for fast lookup by QR number
CREATE INDEX IF NOT EXISTS idx_sales_orders_qr_number 
  ON sales_orders(quotation_request_number) 
  WHERE quotation_request_number IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN sales_orders.quotation_request_number IS 'Unique quotation request number in format QR-YYYY-XXX generated from quotation_request_number_seq';
COMMENT ON COLUMN sales_orders.quotation_request_file_path IS 'Supabase Storage path to uploaded quotation request document';

-- Function to generate next QR number atomically
CREATE OR REPLACE FUNCTION generate_qr_number()
RETURNS VARCHAR(50) AS $$
DECLARE
  next_num INTEGER;
  current_year INTEGER;
  qr_number VARCHAR(50);
BEGIN
  -- Get current year
  current_year := EXTRACT(YEAR FROM CURRENT_DATE);
  
  -- Get next sequence number atomically
  next_num := nextval('quotation_request_number_seq');
  
  -- Format as QR-YYYY-XXX (zero-padded to 3 digits)
  qr_number := 'QR-' || current_year || '-' || LPAD(next_num::TEXT, 3, '0');
  
  RETURN qr_number;
END;
$$ LANGUAGE plpgsql;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION generate_qr_number() TO authenticated;

COMMENT ON FUNCTION generate_qr_number() IS 'Atomically generates unique quotation request number in format QR-YYYY-XXX';
