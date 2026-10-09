-- Fix balance_entries table - change reference_id from UUID to TEXT
-- Drop the existing table and recreate with correct schema
DROP TABLE IF EXISTS balance_entries;

CREATE TABLE balance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('sales_order', 'purchase_order', 'ar_payment', 'ap_payment')),
  reference_id TEXT NOT NULL,  -- Changed from UUID to TEXT to store order numbers
  reference_number TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL,
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
  -- Removed created_by field since app uses localStorage auth, not Supabase auth
);

-- Create indexes for faster queries
CREATE INDEX idx_balance_entries_created_at ON balance_entries(created_at DESC);
CREATE INDEX idx_balance_entries_type ON balance_entries(type);
CREATE INDEX idx_balance_entries_reference_id ON balance_entries(reference_id);
