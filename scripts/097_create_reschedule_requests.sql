-- Create reschedule requests table for CEO approval workflow
CREATE TABLE IF NOT EXISTS reschedule_requests (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER NOT NULL,
  invoice_number VARCHAR(100),
  customer_id INTEGER,
  customer_name VARCHAR(255),
  so_number VARCHAR(100),
  current_months INTEGER NOT NULL,
  requested_months INTEGER NOT NULL,
  current_amount DECIMAL(15,2),
  new_monthly_payment DECIMAL(15,2),
  reason TEXT,
  requested_by VARCHAR(100) DEFAULT 'accountant',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending', -- pending, approved, rejected
  reviewed_by VARCHAR(100),
  reviewed_at TIMESTAMP,
  review_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_reschedule_requests_status ON reschedule_requests(status);
CREATE INDEX IF NOT EXISTS idx_reschedule_requests_invoice_id ON reschedule_requests(invoice_id);
