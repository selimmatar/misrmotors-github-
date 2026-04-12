-- FEATURE A: PO Requests Attachments for Sales Orders
-- Safe, backward-compatible migration

-- Create sales_order_attachments table for PO requests
CREATE TABLE IF NOT EXISTS sales_order_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders(so_id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL CHECK (file_type IN ('pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx')),
  uploaded_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  note TEXT,
  deleted_at TIMESTAMPTZ,
  deleted_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_so_attachments_so_id ON sales_order_attachments(sales_order_id);
CREATE INDEX IF NOT EXISTS idx_so_attachments_uploaded_at ON sales_order_attachments(uploaded_at DESC);

-- Add filtering by non-deleted
CREATE INDEX IF NOT EXISTS idx_so_attachments_active ON sales_order_attachments(sales_order_id) WHERE deleted_at IS NULL;

-- Add comments for documentation
COMMENT ON TABLE sales_order_attachments IS 'PO request documents and attachments linked to sales orders';
COMMENT ON COLUMN sales_order_attachments.file_url IS 'Vercel Blob storage URL for uploaded file';
COMMENT ON COLUMN sales_order_attachments.deleted_at IS 'Soft delete timestamp for audit trail';

-- Grant permissions
GRANT SELECT, INSERT, UPDATE ON sales_order_attachments TO authenticated;
