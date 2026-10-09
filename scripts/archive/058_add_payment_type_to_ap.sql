-- Add payment_type column to accounts_payable to properly track hybrid payments
ALTER TABLE accounts_payable
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20);

-- Migrate existing data: copy from payment_terms
UPDATE accounts_payable
SET payment_type = CASE
  WHEN payment_terms = 'prepaid' THEN 'cash'
  WHEN payment_terms = 'installment' THEN 'installments'
  WHEN payment_terms = 'hybrid' THEN 'hybrid'
  ELSE 'installments'
END
WHERE payment_type IS NULL;

-- For AP invoices with PO links, sync payment_type from purchase_orders
UPDATE accounts_payable ap
SET payment_type = po.payment_type
FROM purchase_orders po
WHERE ap.po_id = po.po_id
  AND po.payment_type IS NOT NULL
  AND (ap.payment_type IS NULL OR ap.payment_type = 'installments');

-- Add hybrid-specific columns if they don't exist
ALTER TABLE accounts_payable
ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS remaining_installment_months INTEGER,
ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(15,2),
ADD COLUMN IF NOT EXISTS payment_start_date DATE;

-- Sync hybrid payment details from purchase_orders
UPDATE accounts_payable ap
SET 
  down_payment_amount = po.down_payment_amount,
  remaining_amount = po.remaining_amount,
  remaining_installment_months = po.remaining_installment_months,
  monthly_amount = po.monthly_amount,
  payment_start_date = po.payment_start_date
FROM purchase_orders po
WHERE ap.po_id = po.po_id
  AND po.payment_type = 'hybrid'
  AND ap.payment_type = 'hybrid';

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_accounts_payable_payment_type ON accounts_payable(payment_type);

COMMENT ON COLUMN accounts_payable.payment_type IS 'Payment method: cash, installments, cheque, hybrid, prepaid';
