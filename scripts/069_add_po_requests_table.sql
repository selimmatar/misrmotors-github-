-- FEATURE A: PO Requests attachments on Sales Orders
-- Create document sequences table for atomic number generation
CREATE TABLE IF NOT EXISTS document_sequences (
  doc_type TEXT PRIMARY KEY,
  last_number BIGINT NOT NULL DEFAULT 0
);

-- Initialize PO_REQUEST sequence
INSERT INTO document_sequences (doc_type, last_number) 
VALUES ('PO_REQUEST', 0)
ON CONFLICT (doc_type) DO NOTHING;

-- Create PO requests table
CREATE TABLE IF NOT EXISTS sales_order_po_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(so_id) ON DELETE CASCADE,
  po_request_number TEXT NOT NULL UNIQUE,
  file_url TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  note TEXT,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id)
);

-- Create indexes for performance
CREATE UNIQUE INDEX IF NOT EXISTS idx_po_request_number ON sales_order_po_requests(po_request_number) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_po_requests_so_id ON sales_order_po_requests(sales_order_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_po_requests_search ON sales_order_po_requests(po_request_number) WHERE deleted_at IS NULL;

-- RLS policies
ALTER TABLE sales_order_po_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view PO requests for accessible sales orders" ON sales_order_po_requests
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM sales_orders 
      WHERE sales_orders.so_id = sales_order_po_requests.sales_order_id
    )
  );

CREATE POLICY "Authenticated users can insert PO requests" ON sales_order_po_requests
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Users can soft delete their own PO requests" ON sales_order_po_requests
  FOR UPDATE USING (uploaded_by = auth.uid() OR auth.jwt() ->> 'user_role' IN ('ceo', 'accountant'));

-- Function to generate next PO request number atomically
CREATE OR REPLACE FUNCTION generate_po_request_number()
RETURNS TEXT AS $$
DECLARE
  new_number BIGINT;
  year_str TEXT;
  formatted_number TEXT;
BEGIN
  -- Get current year
  year_str := TO_CHAR(NOW(), 'YYYY');
  
  -- Atomically increment and get new number
  UPDATE document_sequences 
  SET last_number = last_number + 1
  WHERE doc_type = 'PO_REQUEST'
  RETURNING last_number INTO new_number;
  
  -- Format: PR-2026-000123
  formatted_number := 'PR-' || year_str || '-' || LPAD(new_number::TEXT, 6, '0');
  
  RETURN formatted_number;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
