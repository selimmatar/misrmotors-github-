-- Add idempotency tracking columns to prevent duplicate operations
-- Generated: 2025-01-XX

-- 1. Add processing flags to prevent duplicate payments
ALTER TABLE accounts_payable 
ADD COLUMN IF NOT EXISTS payment_processing BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;

ALTER TABLE accounts_receivable 
ADD COLUMN IF NOT EXISTS payment_processing BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS last_payment_at TIMESTAMPTZ;

-- 2. Add idempotency key to payment schedules
ALTER TABLE payment_schedules
ADD COLUMN IF NOT EXISTS payment_idempotency_key TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

-- 3. Add audit session tracking
ALTER TABLE inventory
ADD COLUMN IF NOT EXISTS audit_session_id TEXT,
ADD COLUMN IF NOT EXISTS last_audit_at TIMESTAMPTZ;

-- 4. Add delivery permit approval tracking
ALTER TABLE delivery_permits
ADD COLUMN IF NOT EXISTS approval_processing BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS approved_by_user_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- 5. Add PO receive tracking
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS receive_processing BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS received_by_user_id UUID REFERENCES auth.users(id),
ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

-- 6. Add PO cost finalization tracking
ALTER TABLE purchase_orders
ADD COLUMN IF NOT EXISTS cost_finalize_processing BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS cost_finalized_by_user_id UUID REFERENCES auth.users(id);

-- 7. Add AR invoice creation tracking (for DP approval)
ALTER TABLE accounts_receivable
ADD COLUMN IF NOT EXISTS source_delivery_permit_id INTEGER REFERENCES delivery_permits(permit_id),
ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES auth.users(id);

-- 8. Create idempotency log table for auditing
CREATE TABLE IF NOT EXISTS idempotency_log (
  id SERIAL PRIMARY KEY,
  operation_type TEXT NOT NULL, -- 'payment', 'audit', 'dp_approval', 'po_receive', etc.
  idempotency_key TEXT NOT NULL,
  entity_type TEXT NOT NULL, -- 'accounts_payable', 'purchase_order', etc.
  entity_id INTEGER NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  status TEXT NOT NULL, -- 'processing', 'completed', 'failed'
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE(operation_type, idempotency_key)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_payment_schedules_idempotency ON payment_schedules(payment_idempotency_key) WHERE payment_idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_idempotency_log_key ON idempotency_log(operation_type, idempotency_key);
CREATE INDEX IF NOT EXISTS idx_ar_source_dp ON accounts_receivable(source_delivery_permit_id) WHERE source_delivery_permit_id IS NOT NULL;

COMMENT ON COLUMN accounts_payable.payment_processing IS 'Lock flag to prevent concurrent payment processing';
COMMENT ON COLUMN payment_schedules.payment_idempotency_key IS 'Unique key to prevent duplicate payment posting (format: pay_{invoice_id}_{schedule_id}_{timestamp})';
COMMENT ON COLUMN idempotency_log.idempotency_key IS 'Client-generated unique key for each operation attempt';
