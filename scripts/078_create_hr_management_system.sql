-- =====================================================================
-- HR MANAGEMENT SYSTEM SCHEMA
-- =====================================================================
-- Comprehensive HR system with employee master data, compensation tracking,
-- job descriptions, document management, and salary payment cycles.
-- 
-- DESIGN PRINCIPLES:
-- - Links to auth.users (UUID) for authentication integration
-- - Isolated from ERP modules (no circular dependencies)
-- - Role-based access (CEO full access, HR admin management, employees self-service)
-- - Secure document storage with RLS policies
-- =====================================================================

-- Step 1: Create departments table (organization structure)
CREATE TABLE IF NOT EXISTS departments (
  department_id SERIAL PRIMARY KEY,
  department_name VARCHAR(100) UNIQUE NOT NULL,
  department_code VARCHAR(20) UNIQUE NOT NULL,
  manager_id UUID, -- FK constraint added conditionally below
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_departments_manager ON departments(manager_id);
CREATE INDEX IF NOT EXISTS idx_departments_active ON departments(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE departments IS 'Organizational departments with hierarchy';

-- Step 2: Create job_positions table (job titles/roles)
CREATE TABLE IF NOT EXISTS job_positions (
  position_id SERIAL PRIMARY KEY,
  position_title VARCHAR(100) NOT NULL,
  position_code VARCHAR(20) UNIQUE NOT NULL,
  department_id INTEGER REFERENCES departments(department_id),
  grade_level VARCHAR(10),
  salary_range_min NUMERIC(12,2),
  salary_range_max NUMERIC(12,2),
  description TEXT,
  requirements TEXT,
  responsibilities TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_positions_department ON job_positions(department_id);
CREATE INDEX IF NOT EXISTS idx_job_positions_active ON job_positions(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE job_positions IS 'Job titles and position definitions';

-- Step 3: Create employees table (master employee data)
CREATE TABLE IF NOT EXISTS hr_employees (
  employee_id SERIAL PRIMARY KEY,
  user_id UUID UNIQUE, -- FK constraint added conditionally below
  employee_number VARCHAR(20) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  national_id VARCHAR(50) UNIQUE,
  email VARCHAR(120) UNIQUE NOT NULL,
  phone VARCHAR(20),
  date_of_birth DATE,
  gender VARCHAR(10) CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say')),
  
  -- Employment details
  department_id INTEGER REFERENCES departments(department_id),
  position_id INTEGER REFERENCES job_positions(position_id),
  manager_id UUID, -- FK constraint added conditionally below
  hire_date DATE NOT NULL,
  employment_status VARCHAR(30) DEFAULT 'active' CHECK (employment_status IN 
    ('active', 'on_leave', 'suspended', 'terminated', 'resigned')),
  employment_type VARCHAR(20) CHECK (employment_type IN ('full_time', 'part_time', 'contract', 'intern')),
  probation_end_date DATE,
  termination_date DATE,
  termination_reason TEXT,
  
  -- Contact information
  address TEXT,
  city VARCHAR(100),
  emergency_contact_name VARCHAR(100),
  emergency_contact_phone VARCHAR(20),
  emergency_contact_relationship VARCHAR(50),
  
  -- System fields
  created_by UUID, -- FK constraint added conditionally below
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hr_employees_user ON hr_employees(user_id);
CREATE INDEX IF NOT EXISTS idx_hr_employees_department ON hr_employees(department_id);
CREATE INDEX IF NOT EXISTS idx_hr_employees_position ON hr_employees(position_id);
CREATE INDEX IF NOT EXISTS idx_hr_employees_manager ON hr_employees(manager_id);
CREATE INDEX IF NOT EXISTS idx_hr_employees_status ON hr_employees(employment_status);
CREATE INDEX IF NOT EXISTS idx_hr_employees_hire_date ON hr_employees(hire_date DESC);

COMMENT ON TABLE hr_employees IS 'Employee master data with employment details';

-- Step 4: Create employee_compensation table (salary history)
CREATE TABLE IF NOT EXISTS employee_compensation (
  compensation_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
  effective_date DATE NOT NULL,
  end_date DATE,
  
  -- Compensation components
  base_salary NUMERIC(12,2) NOT NULL CHECK (base_salary >= 0),
  housing_allowance NUMERIC(12,2) DEFAULT 0,
  transportation_allowance NUMERIC(12,2) DEFAULT 0,
  meal_allowance NUMERIC(12,2) DEFAULT 0,
  other_allowances NUMERIC(12,2) DEFAULT 0,
  allowances_description TEXT,
  
  -- Deductions
  social_insurance NUMERIC(12,2) DEFAULT 0,
  income_tax NUMERIC(12,2) DEFAULT 0,
  other_deductions NUMERIC(12,2) DEFAULT 0,
  deductions_description TEXT,
  
  -- Calculated fields
  gross_salary NUMERIC(12,2) GENERATED ALWAYS AS (
    base_salary + housing_allowance + transportation_allowance + 
    meal_allowance + other_allowances
  ) STORED,
  net_salary NUMERIC(12,2) GENERATED ALWAYS AS (
    base_salary + housing_allowance + transportation_allowance + 
    meal_allowance + other_allowances - social_insurance - income_tax - other_deductions
  ) STORED,
  
  -- Payment details
  payment_frequency VARCHAR(20) DEFAULT 'monthly' CHECK (payment_frequency IN ('weekly', 'bi_weekly', 'monthly', 'quarterly')),
  payment_method VARCHAR(20) CHECK (payment_method IN ('bank_transfer', 'cash', 'cheque')),
  bank_name VARCHAR(100),
  bank_account_number VARCHAR(50),
  
  -- Metadata
  change_reason TEXT,
  approved_by UUID, -- FK constraint added conditionally below
  approved_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_compensation_employee ON employee_compensation(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_effective ON employee_compensation(effective_date DESC);
CREATE INDEX IF NOT EXISTS idx_employee_compensation_active ON employee_compensation(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE employee_compensation IS 'Salary history and compensation records';

-- Step 5: Create salary_payments table (payroll runs)
CREATE TABLE IF NOT EXISTS salary_payments (
  payment_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
  compensation_id INTEGER REFERENCES employee_compensation(compensation_id),
  
  -- Payment period
  pay_period_start DATE NOT NULL,
  pay_period_end DATE NOT NULL,
  payment_date DATE NOT NULL,
  
  -- Payment amounts
  base_salary NUMERIC(12,2) NOT NULL,
  total_allowances NUMERIC(12,2) DEFAULT 0,
  total_deductions NUMERIC(12,2) DEFAULT 0,
  gross_amount NUMERIC(12,2) NOT NULL,
  net_amount NUMERIC(12,2) NOT NULL,
  
  -- Bonuses and adjustments (for this payment only)
  bonus_amount NUMERIC(12,2) DEFAULT 0,
  bonus_description TEXT,
  overtime_hours NUMERIC(5,2) DEFAULT 0,
  overtime_amount NUMERIC(12,2) DEFAULT 0,
  adjustments NUMERIC(12,2) DEFAULT 0,
  adjustment_notes TEXT,
  
  -- Payment details
  payment_method VARCHAR(20),
  payment_reference VARCHAR(100),
  payment_status VARCHAR(20) DEFAULT 'pending' CHECK (payment_status IN ('pending', 'processed', 'paid', 'cancelled')),
  
  -- Metadata
  processed_by UUID, -- FK constraint added conditionally below
  processed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_salary_payments_employee ON salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_date ON salary_payments(payment_date DESC);
CREATE INDEX IF NOT EXISTS idx_salary_payments_status ON salary_payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_salary_payments_period ON salary_payments(pay_period_start, pay_period_end);

COMMENT ON TABLE salary_payments IS 'Individual salary payment records (payroll runs)';

-- Step 6: Create employee_documents table (secure document storage)
CREATE TABLE IF NOT EXISTS employee_documents (
  document_id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
  document_type VARCHAR(50) NOT NULL CHECK (document_type IN (
    'contract', 'national_id', 'passport', 'certificate', 'diploma',
    'performance_review', 'warning', 'resignation', 'termination', 'other'
  )),
  document_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size_kb INTEGER,
  mime_type VARCHAR(100),
  
  -- Document metadata
  document_date DATE,
  expiry_date DATE,
  description TEXT,
  is_confidential BOOLEAN DEFAULT TRUE,
  
  -- Access control
  uploaded_by UUID, -- FK constraint added conditionally below
  uploaded_at TIMESTAMPTZ DEFAULT NOW(),
  last_accessed_by UUID, -- FK constraint added conditionally below
  last_accessed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employee_documents_employee ON employee_documents(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_documents_type ON employee_documents(document_type);
CREATE INDEX IF NOT EXISTS idx_employee_documents_expiry ON employee_documents(expiry_date) WHERE expiry_date IS NOT NULL;

COMMENT ON TABLE employee_documents IS 'Secure employee document storage';

-- Step 7: Create job_descriptions table (rich text storage)
CREATE TABLE IF NOT EXISTS job_descriptions (
  job_description_id SERIAL PRIMARY KEY,
  position_id INTEGER REFERENCES job_positions(position_id),
  employee_id INTEGER REFERENCES hr_employees(employee_id),
  
  -- Description can be position-level or employee-specific
  title VARCHAR(200) NOT NULL,
  description_type VARCHAR(20) CHECK (description_type IN ('position_template', 'employee_specific')),
  
  -- Job description content
  overview TEXT,
  responsibilities TEXT, -- Rich text/HTML
  requirements TEXT, -- Rich text/HTML
  qualifications TEXT,
  kpis TEXT, -- Key Performance Indicators
  reporting_structure TEXT,
  
  -- Document URL if uploaded
  document_url TEXT,
  
  -- Versioning
  version INTEGER DEFAULT 1,
  is_active BOOLEAN DEFAULT TRUE,
  effective_date DATE,
  
  -- Metadata
  created_by UUID, -- FK constraint added conditionally below
  approved_by UUID, -- FK constraint added conditionally below
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_job_descriptions_position ON job_descriptions(position_id);
CREATE INDEX IF NOT EXISTS idx_job_descriptions_employee ON job_descriptions(employee_id);
CREATE INDEX IF NOT EXISTS idx_job_descriptions_active ON job_descriptions(is_active) WHERE is_active = TRUE;

COMMENT ON TABLE job_descriptions IS 'Job descriptions for positions and employees';

-- Step 8: Create employee sequence for auto-generated employee numbers
CREATE SEQUENCE IF NOT EXISTS employee_number_seq START 1001;

-- Step 9: Create function to generate employee numbers
CREATE OR REPLACE FUNCTION generate_employee_number() 
RETURNS VARCHAR(20) AS $$
DECLARE
  next_number INTEGER;
BEGIN
  next_number := nextval('employee_number_seq');
  RETURN 'EMP-' || TO_CHAR(CURRENT_DATE, 'YYYY') || '-' || LPAD(next_number::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION generate_employee_number IS 'Generates employee numbers in format EMP-YYYY-XXXX';

-- Step 9b: Conditionally add foreign key constraints to auth.users
-- This handles databases that use auth.users(id) UUID vs users(user_id) INTEGER
DO $$
BEGIN
  -- Check if auth.users table exists with id UUID column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'auth' 
      AND table_name = 'users' 
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    -- Add FK constraints to departments
    ALTER TABLE departments
    DROP CONSTRAINT IF EXISTS fk_departments_manager;
    
    ALTER TABLE departments
    ADD CONSTRAINT fk_departments_manager
    FOREIGN KEY (manager_id) REFERENCES auth.users(id);
    
    -- Add FK constraints to hr_employees
    ALTER TABLE hr_employees
    DROP CONSTRAINT IF EXISTS fk_hr_employees_user,
    DROP CONSTRAINT IF EXISTS fk_hr_employees_manager,
    DROP CONSTRAINT IF EXISTS fk_hr_employees_created_by;
    
    ALTER TABLE hr_employees
    ADD CONSTRAINT fk_hr_employees_user
    FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
    ADD CONSTRAINT fk_hr_employees_manager
    FOREIGN KEY (manager_id) REFERENCES auth.users(id),
    ADD CONSTRAINT fk_hr_employees_created_by
    FOREIGN KEY (created_by) REFERENCES auth.users(id);
    
    -- Add FK constraints to employee_compensation
    ALTER TABLE employee_compensation
    DROP CONSTRAINT IF EXISTS fk_employee_compensation_approved_by;
    
    ALTER TABLE employee_compensation
    ADD CONSTRAINT fk_employee_compensation_approved_by
    FOREIGN KEY (approved_by) REFERENCES auth.users(id);
    
    -- Add FK constraints to salary_payments
    ALTER TABLE salary_payments
    DROP CONSTRAINT IF EXISTS fk_salary_payments_processed_by;
    
    ALTER TABLE salary_payments
    ADD CONSTRAINT fk_salary_payments_processed_by
    FOREIGN KEY (processed_by) REFERENCES auth.users(id);
    
    -- Add FK constraints to employee_documents
    ALTER TABLE employee_documents
    DROP CONSTRAINT IF EXISTS fk_employee_documents_uploaded_by,
    DROP CONSTRAINT IF EXISTS fk_employee_documents_last_accessed_by;
    
    ALTER TABLE employee_documents
    ADD CONSTRAINT fk_employee_documents_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES auth.users(id),
    ADD CONSTRAINT fk_employee_documents_last_accessed_by
    FOREIGN KEY (last_accessed_by) REFERENCES auth.users(id);
    
    -- Add FK constraints to job_descriptions
    ALTER TABLE job_descriptions
    DROP CONSTRAINT IF EXISTS fk_job_descriptions_created_by,
    DROP CONSTRAINT IF EXISTS fk_job_descriptions_approved_by;
    
    ALTER TABLE job_descriptions
    ADD CONSTRAINT fk_job_descriptions_created_by
    FOREIGN KEY (created_by) REFERENCES auth.users(id),
    ADD CONSTRAINT fk_job_descriptions_approved_by
    FOREIGN KEY (approved_by) REFERENCES auth.users(id);
    
    RAISE NOTICE 'Added FK constraints: HR tables -> auth.users(id)';
  ELSE
    RAISE NOTICE 'Skipped FK constraints: auth.users(id) column not found';
    RAISE NOTICE 'UUID columns (user_id, manager_id, etc.) will remain without FK constraints';
    RAISE NOTICE 'Adjust manually if using different user table structure';
  END IF;
END $$;

-- Step 10: Enable Row Level Security on all HR tables
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE hr_employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_compensation ENABLE ROW LEVEL SECURITY;
ALTER TABLE salary_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_descriptions ENABLE ROW LEVEL SECURITY;

-- Step 11: Create RLS policies for HR system
-- Note: Following the system pattern of simple authenticated access
-- Role-based authorization is enforced at the application/API level

-- Departments table
CREATE POLICY "authenticated_departments_all" ON departments 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_departments_all" ON departments 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Job Positions table
CREATE POLICY "authenticated_job_positions_all" ON job_positions 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_job_positions_all" ON job_positions 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- HR Employees table
CREATE POLICY "authenticated_hr_employees_all" ON hr_employees 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_hr_employees_all" ON hr_employees 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Employee Compensation table
CREATE POLICY "authenticated_employee_compensation_all" ON employee_compensation 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_employee_compensation_all" ON employee_compensation 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Salary Payments table
CREATE POLICY "authenticated_salary_payments_all" ON salary_payments 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_salary_payments_all" ON salary_payments 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Employee Documents table
CREATE POLICY "authenticated_employee_documents_all" ON employee_documents 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_employee_documents_all" ON employee_documents 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Job Descriptions table
CREATE POLICY "authenticated_job_descriptions_all" ON job_descriptions 
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "service_role_job_descriptions_all" ON job_descriptions 
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;

-- Service role bypass policies (for API routes)
CREATE POLICY "service_role_departments" ON departments FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_job_positions" ON job_positions FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_hr_employees" ON hr_employees FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_compensation" ON employee_compensation FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_salary_payments" ON salary_payments FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_documents" ON employee_documents FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_job_descriptions" ON job_descriptions FOR ALL TO service_role USING (true);

-- Step 12: Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_hr_employees_name_search ON hr_employees USING gin(to_tsvector('english', full_name));
CREATE INDEX IF NOT EXISTS idx_job_descriptions_content_search ON job_descriptions USING gin(to_tsvector('english', coalesce(overview, '') || ' ' || coalesce(responsibilities, '')));

-- Step 13: Insert seed data
INSERT INTO departments (department_name, department_code, description) VALUES
('Sales', 'SALES', 'Sales and business development'),
('Finance & Accounting', 'FIN', 'Finance, accounting, and payroll'),
('Operations', 'OPS', 'Operations and logistics'),
('Warehouse', 'WH', 'Warehouse and inventory management'),
('Procurement', 'PROC', 'Purchasing and supplier management'),
('Human Resources', 'HR', 'Human resources and administration'),
('Executive', 'EXEC', 'Executive management')
ON CONFLICT (department_code) DO NOTHING;

INSERT INTO job_positions (position_title, position_code, department_id, grade_level, salary_range_min, salary_range_max) VALUES
('Chief Executive Officer', 'CEO', (SELECT department_id FROM departments WHERE department_code = 'EXEC'), 'C1', 50000, 100000),
('Accountant', 'ACC', (SELECT department_id FROM departments WHERE department_code = 'FIN'), 'M2', 15000, 30000),
('Sales Representative', 'SALES-REP', (SELECT department_id FROM departments WHERE department_code = 'SALES'), 'L1', 10000, 20000),
('Warehouse Manager', 'WH-MGR', (SELECT department_id FROM departments WHERE department_code = 'WH'), 'M1', 12000, 25000),
('Purchasing Officer', 'PO-OFF', (SELECT department_id FROM departments WHERE department_code = 'PROC'), 'L2', 10000, 18000),
('HR Manager', 'HR-MGR', (SELECT department_id FROM departments WHERE department_code = 'HR'), 'M1', 15000, 28000),
('Shipment Coordinator', 'SHIP-COORD', (SELECT department_id FROM departments WHERE department_code = 'OPS'), 'L1', 8000, 15000)
ON CONFLICT (position_code) DO NOTHING;

COMMIT;

-- Verification queries
-- SELECT * FROM departments ORDER BY department_id;
-- SELECT * FROM job_positions ORDER BY position_id;
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%hr_%' OR tablename IN ('departments', 'job_positions');
