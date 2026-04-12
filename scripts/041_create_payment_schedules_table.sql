-- Create payment schedules table for tracking installment payments
CREATE TABLE IF NOT EXISTS payment_schedules (
  schedule_id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES accounts_receivable(invoice_id) ON DELETE CASCADE,
  installment_number INTEGER NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  paid_amount NUMERIC(15,2) DEFAULT 0,
  payment_date DATE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'overdue', 'partial')),
  receipt_url TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(invoice_id, installment_number)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_payment_schedules_invoice ON payment_schedules(invoice_id);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_status ON payment_schedules(status);
CREATE INDEX IF NOT EXISTS idx_payment_schedules_due_date ON payment_schedules(due_date);

-- Add trigger to update updated_at
CREATE OR REPLACE FUNCTION update_payment_schedule_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_schedules_updated_at ON payment_schedules;
CREATE TRIGGER payment_schedules_updated_at
  BEFORE UPDATE ON payment_schedules
  FOR EACH ROW
  EXECUTE FUNCTION update_payment_schedule_timestamp();
