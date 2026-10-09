-- =========================================================
-- INVOICE CONSOLIDATION FEATURE
-- Many-to-Many relationship between invoices and delivery permits
-- Allows multiple DPs to be consolidated into ONE invoice
-- =========================================================

-- Create the many-to-many link table
CREATE TABLE IF NOT EXISTS invoice_delivery_permits (
  invoice_id INTEGER NOT NULL REFERENCES accounts_receivable(invoice_id) ON DELETE CASCADE,
  permit_id INTEGER NOT NULL REFERENCES delivery_permits(permit_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invoice_id, permit_id),
  UNIQUE (permit_id) -- Prevent a DP from being invoiced twice
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_delivery_permits_invoice_id ON invoice_delivery_permits(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_delivery_permits_permit_id ON invoice_delivery_permits(permit_id);

-- Enable RLS
ALTER TABLE invoice_delivery_permits ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
DROP POLICY IF EXISTS "Allow all operations on invoice_delivery_permits" ON invoice_delivery_permits;
CREATE POLICY "Allow all operations on invoice_delivery_permits" ON invoice_delivery_permits FOR ALL USING (true) WITH CHECK (true);

-- Add invoice_id to delivery_permits if it doesn't exist (for backward compatibility)
-- But invoice_delivery_permits is now the source of truth
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'delivery_permits' AND column_name = 'invoice_id'
  ) THEN
    ALTER TABLE delivery_permits ADD COLUMN invoice_id INTEGER REFERENCES accounts_receivable(invoice_id);
    CREATE INDEX IF NOT EXISTS idx_delivery_permits_invoice_id ON delivery_permits(invoice_id);
  END IF;
END $$;

-- Verification
SELECT 'invoice_delivery_permits table created successfully' AS status 
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoice_delivery_permits');

COMMENT ON TABLE invoice_delivery_permits IS 'Many-to-many link between invoices and delivery permits for consolidation';
COMMENT ON COLUMN invoice_delivery_permits.permit_id IS 'Unique constraint ensures each DP can only be invoiced once';
