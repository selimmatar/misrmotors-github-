-- Create balance_entries table to track all balance changes
CREATE TABLE IF NOT EXISTS balance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('sales_order', 'purchase_order', 'ar_payment', 'ap_payment')),
  reference_id UUID NOT NULL,
  reference_number TEXT NOT NULL,
  amount DECIMAL(12, 2) NOT NULL, -- Positive for income, negative for expenses
  description TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_by UUID REFERENCES users(id)
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_balance_entries_created_at ON balance_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_balance_entries_type ON balance_entries(type);
