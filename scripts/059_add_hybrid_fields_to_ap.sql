-- Add missing hybrid payment fields to accounts_payable table
-- This ensures all hybrid payment details are persisted at the invoice level

-- Add columns if they don't exist
DO $$ 
BEGIN
  -- down_payment_percent
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_payable' AND column_name = 'down_payment_percent') THEN
    ALTER TABLE accounts_payable ADD COLUMN down_payment_percent DECIMAL(5,2);
  END IF;
  
  -- down_payment_type (amount or percent)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_payable' AND column_name = 'down_payment_type') THEN
    ALTER TABLE accounts_payable ADD COLUMN down_payment_type VARCHAR(20) DEFAULT 'amount';
  END IF;
  
  -- down_payment_due_date
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_payable' AND column_name = 'down_payment_due_date') THEN
    ALTER TABLE accounts_payable ADD COLUMN down_payment_due_date DATE;
  END IF;
  
  -- schedule_entries (JSON for manual schedule)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_payable' AND column_name = 'schedule_entries') THEN
    ALTER TABLE accounts_payable ADD COLUMN schedule_entries JSONB;
  END IF;
  
  -- schedule_mode (AUTO or MANUAL)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_payable' AND column_name = 'schedule_mode') THEN
    ALTER TABLE accounts_payable ADD COLUMN schedule_mode VARCHAR(20) DEFAULT 'AUTO';
  END IF;
  
  -- pdf_url for storing generated invoice PDF
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_payable' AND column_name = 'pdf_url') THEN
    ALTER TABLE accounts_payable ADD COLUMN pdf_url TEXT;
  END IF;
END $$;

-- Update existing hybrid invoices to copy fields from their POs
UPDATE accounts_payable ap
SET 
  payment_type = COALESCE(ap.payment_type, po.payment_type),
  down_payment_amount = COALESCE(ap.down_payment_amount, po.down_payment_amount),
  down_payment_percent = COALESCE(ap.down_payment_percent, po.down_payment_percent),
  down_payment_type = COALESCE(ap.down_payment_type, po.down_payment_type, 'amount'),
  down_payment_due_date = COALESCE(ap.down_payment_due_date, po.down_payment_due_date),
  remaining_amount = COALESCE(ap.remaining_amount, po.remaining_amount),
  remaining_installment_months = COALESCE(ap.remaining_installment_months, po.remaining_installment_months),
  monthly_amount = COALESCE(ap.monthly_amount, po.monthly_amount),
  payment_start_date = COALESCE(ap.payment_start_date, po.payment_start_date),
  schedule_entries = COALESCE(ap.schedule_entries, po.schedule_entries),
  schedule_mode = COALESCE(ap.schedule_mode, po.schedule_mode, 'AUTO')
FROM purchase_orders po
WHERE ap.po_id = po.po_id
  AND po.payment_type = 'hybrid'
  AND (ap.payment_type IS NULL OR ap.payment_type != 'hybrid');

-- Add same fields to accounts_receivable if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts_receivable' AND column_name = 'pdf_url') THEN
    ALTER TABLE accounts_receivable ADD COLUMN pdf_url TEXT;
  END IF;
END $$;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_ap_payment_type ON accounts_payable(payment_type);
CREATE INDEX IF NOT EXISTS idx_ap_po_id ON accounts_payable(po_id);
