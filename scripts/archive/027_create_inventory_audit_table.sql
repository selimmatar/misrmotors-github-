-- Create inventory_audits table for storing audit records
CREATE TABLE IF NOT EXISTS inventory_audits (
  audit_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id),
  system_quantity INTEGER NOT NULL,
  physical_count INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  notes TEXT,
  audited_by INTEGER REFERENCES users(user_id),
  audit_date TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_inventory_audits_product_id ON inventory_audits(product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_audit_date ON inventory_audits(audit_date);

-- Add comment to table
COMMENT ON TABLE inventory_audits IS 'Stores inventory audit records comparing physical counts to system quantities';
