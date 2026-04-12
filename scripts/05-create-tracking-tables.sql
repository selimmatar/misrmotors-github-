-- Create Inventory Transactions table for audit trail
CREATE TABLE inventory_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  transaction_type TEXT NOT NULL CHECK (transaction_type IN ('purchase', 'sale', 'adjustment', 'return')),
  reference_type TEXT CHECK (reference_type IN ('purchase_order', 'sales_order', 'manual')),
  reference_id UUID,
  reference_number TEXT,
  quantity_change INTEGER NOT NULL,
  quantity_before INTEGER NOT NULL,
  quantity_after INTEGER NOT NULL,
  notes TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create Balance Entries table for financial tracking
CREATE TABLE balance_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_type TEXT NOT NULL CHECK (entry_type IN ('sales_order', 'purchase_order', 'ar_payment', 'ap_payment', 'adjustment')),
  reference_type TEXT NOT NULL,
  reference_id UUID NOT NULL,
  reference_number TEXT NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  description TEXT NOT NULL,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'voided')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_inventory_txn_product ON inventory_transactions(product_id);
CREATE INDEX idx_inventory_txn_type ON inventory_transactions(transaction_type);
CREATE INDEX idx_inventory_txn_created ON inventory_transactions(created_at);
CREATE INDEX idx_balance_entries_type ON balance_entries(entry_type);
CREATE INDEX idx_balance_entries_ref ON balance_entries(reference_id);
CREATE INDEX idx_balance_entries_created ON balance_entries(created_at);
