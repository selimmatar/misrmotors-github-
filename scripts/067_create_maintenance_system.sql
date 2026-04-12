-- Maintenance Management System Tables

-- Maintenance Work Orders Table
CREATE TABLE IF NOT EXISTS maintenance_work_orders (
  work_order_id SERIAL PRIMARY KEY,
  work_order_number VARCHAR(50) UNIQUE NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  
  -- Customer/Location Information
  customer_id INTEGER REFERENCES customers(customer_id),
  customer_name VARCHAR(255),
  location TEXT,
  
  -- Work Order Details
  priority VARCHAR(20) DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  category VARCHAR(50), -- e.g., 'repair', 'installation', 'inspection', 'preventive'
  status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'assigned', 'in_progress', 'completed', 'cancelled', 'on_hold')),
  
  -- Assignment
  assigned_to INTEGER REFERENCES hr_employees(employee_id),
  assigned_by VARCHAR(255), -- User ID who assigned the work order
  assigned_at TIMESTAMP,
  
  -- Scheduling
  scheduled_date DATE,
  scheduled_time TIME,
  estimated_hours DECIMAL(10,2),
  
  -- Financial
  estimated_cost DECIMAL(15,2),
  actual_cost DECIMAL(15,2),
  billable BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  
  -- Additional Info
  notes TEXT,
  created_by VARCHAR(255) -- User ID who created the work order
);

-- Maintenance Reports Table
CREATE TABLE IF NOT EXISTS maintenance_reports (
  report_id SERIAL PRIMARY KEY,
  work_order_id INTEGER REFERENCES maintenance_work_orders(work_order_id) ON DELETE CASCADE,
  
  -- Report Details
  report_type VARCHAR(50) DEFAULT 'completion', -- 'completion', 'inspection', 'issue'
  summary TEXT NOT NULL,
  findings TEXT,
  actions_taken TEXT,
  
  -- Work Details
  actual_hours DECIMAL(10,2),
  actual_cost DECIMAL(15,2),
  
  -- Parts/Materials Used
  parts_used JSONB, -- [{part_id, part_name, quantity, cost}]
  
  -- Status & Quality
  work_quality VARCHAR(20) CHECK (work_quality IN ('excellent', 'good', 'satisfactory', 'needs_improvement')),
  issues_found TEXT,
  follow_up_required BOOLEAN DEFAULT false,
  follow_up_notes TEXT,
  
  -- Signatures & Approval
  technician_signature VARCHAR(255),
  customer_signature VARCHAR(255),
  customer_satisfaction VARCHAR(20) CHECK (customer_satisfaction IN ('very_satisfied', 'satisfied', 'neutral', 'dissatisfied', 'very_dissatisfied')),
  
  -- Attachments
  photos JSONB, -- Array of photo URLs
  documents JSONB, -- Array of document URLs
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES hr_employees(employee_id),
  submitted_at TIMESTAMP,
  approved_at TIMESTAMP,
  approved_by VARCHAR(255) -- User ID who approved
);

-- Maintenance to Accounts Receivable Link Table
CREATE TABLE IF NOT EXISTS maintenance_ar_invoices (
  id SERIAL PRIMARY KEY,
  work_order_id INTEGER REFERENCES maintenance_work_orders(work_order_id) ON DELETE CASCADE,
  invoice_id INTEGER, -- Link to AR invoice when created
  
  -- Invoice Details
  invoice_amount DECIMAL(15,2) NOT NULL,
  invoice_status VARCHAR(50) DEFAULT 'draft',
  invoice_date DATE DEFAULT CURRENT_DATE,
  due_date DATE,
  
  -- Additional charges
  labor_cost DECIMAL(15,2),
  parts_cost DECIMAL(15,2),
  additional_charges DECIMAL(15,2),
  tax_amount DECIMAL(15,2),
  discount_amount DECIMAL(15,2),
  
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  created_by VARCHAR(255) -- User ID who created the invoice
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_work_orders_status ON maintenance_work_orders(status);
CREATE INDEX IF NOT EXISTS idx_work_orders_assigned_to ON maintenance_work_orders(assigned_to);
CREATE INDEX IF NOT EXISTS idx_work_orders_customer ON maintenance_work_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_scheduled ON maintenance_work_orders(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_reports_work_order ON maintenance_reports(work_order_id);
CREATE INDEX IF NOT EXISTS idx_ar_invoices_work_order ON maintenance_ar_invoices(work_order_id);

-- Function to generate work order number
CREATE OR REPLACE FUNCTION generate_work_order_number()
RETURNS VARCHAR AS $$
DECLARE
  next_number INTEGER;
  wo_number VARCHAR(50);
BEGIN
  SELECT COALESCE(MAX(CAST(SUBSTRING(work_order_number FROM 4) AS INTEGER)), 0) + 1
  INTO next_number
  FROM maintenance_work_orders
  WHERE work_order_number LIKE 'WO-%';
  
  wo_number := 'WO-' || LPAD(next_number::TEXT, 6, '0');
  RETURN wo_number;
END;
$$ LANGUAGE plpgsql;

-- Enable RLS
ALTER TABLE maintenance_work_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_ar_invoices ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow all for authenticated users - can be refined later)
CREATE POLICY "Allow all for authenticated users" ON maintenance_work_orders FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON maintenance_reports FOR ALL USING (true);
CREATE POLICY "Allow all for authenticated users" ON maintenance_ar_invoices FOR ALL USING (true);
