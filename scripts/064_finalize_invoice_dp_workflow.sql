-- Finalize invoice-delivery permit many-to-many relationship
-- Idempotent migration

-- Step 1: Create junction table if not exists
CREATE TABLE IF NOT EXISTS invoice_delivery_permits (
  invoice_id INTEGER NOT NULL REFERENCES accounts_receivable(invoice_id) ON DELETE CASCADE,
  permit_id INTEGER NOT NULL REFERENCES delivery_permits(permit_id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (invoice_id, permit_id)
);

-- Step 2: Add unique constraint to prevent double-invoicing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'invoice_delivery_permits_permit_id_unique'
  ) THEN
    ALTER TABLE invoice_delivery_permits 
    ADD CONSTRAINT invoice_delivery_permits_permit_id_unique UNIQUE (permit_id);
  END IF;
END $$;

-- Step 3: Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_invoice_delivery_permits_invoice 
  ON invoice_delivery_permits(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_delivery_permits_permit 
  ON invoice_delivery_permits(permit_id);

-- Removed payment_terms_id foreign key since payment_terms table doesn't exist
-- Payment information is stored directly in accounts_receivable.payment_terms as text

-- Step 4: Enable RLS on junction table
ALTER TABLE invoice_delivery_permits ENABLE ROW LEVEL SECURITY;

-- Step 5: Create RLS policies
DO $$
BEGIN
  -- Policy for authenticated users to read
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'invoice_delivery_permits' AND policyname = 'Allow authenticated read'
  ) THEN
    CREATE POLICY "Allow authenticated read" ON invoice_delivery_permits
      FOR SELECT TO authenticated USING (true);
  END IF;

  -- Policy for service role to manage
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'invoice_delivery_permits' AND policyname = 'Allow service role all'
  ) THEN
    CREATE POLICY "Allow service role all" ON invoice_delivery_permits
      FOR ALL TO service_role USING (true);
  END IF;
END $$;

COMMENT ON TABLE invoice_delivery_permits IS 'Many-to-many link: one invoice can consolidate multiple DPs';
COMMENT ON CONSTRAINT invoice_delivery_permits_permit_id_unique ON invoice_delivery_permits IS 'Prevents double-invoicing: each DP can only be invoiced once';
