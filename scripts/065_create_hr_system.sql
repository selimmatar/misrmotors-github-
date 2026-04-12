-- Create comprehensive HR management system

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  employee_id SERIAL PRIMARY KEY,
  employee_number VARCHAR(50) UNIQUE NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) UNIQUE,
  phone VARCHAR(50),
  national_id VARCHAR(50),
  date_of_birth DATE,
  hire_date DATE NOT NULL,
  department VARCHAR(100),
  position VARCHAR(100),
  employment_type VARCHAR(50), -- full-time, part-time, contract
  status VARCHAR(50) DEFAULT 'active', -- active, inactive, terminated
  base_salary DECIMAL(12, 2),
  bank_account VARCHAR(100),
  emergency_contact_name VARCHAR(255),
  emergency_contact_phone VARCHAR(50),
  address TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Employee documents table
CREATE TABLE IF NOT EXISTS employee_documents (
  document_id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(employee_id) ON DELETE CASCADE,
  document_name VARCHAR(255) NOT NULL,
  document_type VARCHAR(100), -- contract, id_copy, certificate, etc.
  document_url TEXT NOT NULL,
  uploaded_by VARCHAR(255),
  upload_date TIMESTAMP DEFAULT NOW(),
  notes TEXT
);

-- Bonuses table
CREATE TABLE IF NOT EXISTS employee_bonuses (
  bonus_id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(employee_id) ON DELETE CASCADE,
  bonus_type VARCHAR(100), -- performance, holiday, project, etc.
  amount DECIMAL(12, 2) NOT NULL,
  bonus_date DATE NOT NULL,
  reason TEXT,
  approved_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Deductions table
CREATE TABLE IF NOT EXISTS employee_deductions (
  deduction_id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(employee_id) ON DELETE CASCADE,
  deduction_type VARCHAR(100), -- tax, insurance, loan, penalty, etc.
  amount DECIMAL(12, 2) NOT NULL,
  deduction_date DATE NOT NULL,
  reason TEXT,
  approved_by VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Salary payments table
CREATE TABLE IF NOT EXISTS salary_payments (
  payment_id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(employee_id) ON DELETE CASCADE,
  payment_month DATE NOT NULL, -- First day of the month
  base_amount DECIMAL(12, 2) NOT NULL,
  total_bonuses DECIMAL(12, 2) DEFAULT 0,
  total_deductions DECIMAL(12, 2) DEFAULT 0,
  net_amount DECIMAL(12, 2) NOT NULL,
  payment_date DATE,
  payment_status VARCHAR(50) DEFAULT 'pending', -- pending, paid, cancelled
  payment_method VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Salary reminders table
CREATE TABLE IF NOT EXISTS salary_reminders (
  reminder_id SERIAL PRIMARY KEY,
  payment_month DATE NOT NULL,
  reminder_date DATE NOT NULL,
  status VARCHAR(50) DEFAULT 'pending', -- pending, sent, dismissed
  created_at TIMESTAMP DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_bonuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_deductions ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_reminders ENABLE ROW LEVEL SECURITY;

-- RLS Policies (allow authenticated users full access)
CREATE POLICY "Allow all for authenticated users" ON employees FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON employee_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON employee_bonuses FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON employee_deductions FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON salary_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Allow all for authenticated users" ON salary_reminders FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department);
CREATE INDEX IF NOT EXISTS idx_employee_documents_employee_id ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_bonuses_employee_id ON employee_bonuses(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_deductions_employee_id ON employee_deductions(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_employee_id ON salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_month ON salary_payments(payment_month);
CREATE INDEX IF NOT EXISTS idx_salary_reminders_date ON salary_reminders(reminder_date);
