-- Add new payment type fields to sales_orders table
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'cash',
ADD COLUMN IF NOT EXISTS down_payment_type VARCHAR(10),
ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS down_payment_percent NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS remaining_installment_months INTEGER,
ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS cheque_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS cheque_bank_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS cheque_due_date DATE,
ADD COLUMN IF NOT EXISTS cheque_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS cheque_notes TEXT,
ADD COLUMN IF NOT EXISTS down_payment_cheque_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS down_payment_cheque_bank VARCHAR(100),
ADD COLUMN IF NOT EXISTS down_payment_cheque_due_date DATE;

-- Add new payment type fields to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS payment_type VARCHAR(20) DEFAULT 'cash',
ADD COLUMN IF NOT EXISTS down_payment_type VARCHAR(10),
ADD COLUMN IF NOT EXISTS down_payment_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS down_payment_percent NUMERIC(5,2),
ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS remaining_installment_months INTEGER,
ADD COLUMN IF NOT EXISTS monthly_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS cheque_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS cheque_bank_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS cheque_due_date DATE,
ADD COLUMN IF NOT EXISTS cheque_amount NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS cheque_notes TEXT,
ADD COLUMN IF NOT EXISTS down_payment_cheque_number VARCHAR(50),
ADD COLUMN IF NOT EXISTS down_payment_cheque_bank VARCHAR(100),
ADD COLUMN IF NOT EXISTS down_payment_cheque_due_date DATE;

-- Migrate existing payment_terms to payment_type
UPDATE sales_orders 
SET payment_type = CASE 
  WHEN payment_terms = 'prepaid' THEN 'cash'
  WHEN payment_terms = 'installment' THEN 'installments'
  ELSE 'cash'
END
WHERE payment_type IS NULL OR payment_type = 'cash';

UPDATE purchase_orders 
SET payment_type = CASE 
  WHEN payment_terms = 'prepaid' THEN 'cash'
  WHEN payment_terms = 'installment' THEN 'installments'
  ELSE 'cash'
END
WHERE payment_type IS NULL OR payment_type = 'cash';

-- Update monthly_amount for existing installment orders
UPDATE sales_orders 
SET monthly_amount = ROUND(total / NULLIF(installments, 0), 2)
WHERE payment_type = 'installments' AND installments > 0 AND monthly_amount IS NULL;

UPDATE purchase_orders 
SET monthly_amount = ROUND(total / NULLIF(installments, 0), 2)
WHERE payment_type = 'installments' AND installments > 0 AND monthly_amount IS NULL;
