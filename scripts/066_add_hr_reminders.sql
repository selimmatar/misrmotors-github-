-- Add salary reminders table
CREATE TABLE IF NOT EXISTS salary_reminders (
  reminder_id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES hr_employees(employee_id) ON DELETE CASCADE,
  payment_month DATE NOT NULL,
  reminder_date DATE NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'paid', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes
CREATE INDEX IF NOT EXISTS idx_salary_reminders_employee ON salary_reminders(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_reminders_status ON salary_reminders(status);
CREATE INDEX IF NOT EXISTS idx_salary_reminders_date ON salary_reminders(reminder_date);

-- Enable RLS
ALTER TABLE salary_reminders ENABLE ROW LEVEL SECURITY;

-- Create RLS policy
DROP POLICY IF EXISTS "Allow all operations for authenticated users" ON salary_reminders;
CREATE POLICY "Allow all operations for authenticated users" ON salary_reminders
  FOR ALL USING (true) WITH CHECK (true);
