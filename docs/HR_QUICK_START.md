# HR Management System - Quick Start Guide

## 🚀 Getting Started

### 1. Run the Database Migration

Execute the HR management schema:
\`\`\`bash
# In v0, run this script via the execute script button
scripts/archive/078_create_hr_management_system.sql
\`\`\`

**Expected Output:**
- ✅ Tables created: departments, job_positions, hr_employees, employee_compensation, salary_payments, employee_documents, job_descriptions
- ✅ RLS policies enabled
- ✅ FK constraints added (if auth.users exists) or skipped with notice

### 2. Access the HR Module

**For CEO Users:**
1. Log in with CEO credentials
2. Look for "HR Management" (إدارة الموارد البشرية) in the sidebar navigation
3. Icon: UserCog (person with gear icon)
4. Position: Between "CEO Chat" and "Suppliers"

**For Admin Users:**
1. Log in with Admin credentials
2. Look for "HR Management" in the sidebar
3. Position: Between "User Management" and "Metrics Validation"

### 3. Initial Setup

**Step 1: Create Departments**
- Click "Departments" tab
- Add departments (e.g., "Sales", "Operations", "IT", "Finance")
- Departments are required before adding employees

**Step 2: Create Job Positions**
- Click "Positions" tab
- Add positions (e.g., "Manager", "Sales Executive", "Accountant")
- Link positions to departments

**Step 3: Add Employees**
- Click "Employees" tab → "Add Employee"
- Required fields:
  - Full Name
  - Email (must be unique)
  - Employee Number (auto-generated if empty: EMP-2025-0001)
  - Hire Date
  - Department & Position
- Optional fields:
  - National ID
  - Phone, Address
  - Emergency Contact
  - Employment Type

**Step 4: Set Up Compensation**
- Select an employee from the list
- Click on their name to view profile
- Go to "Salary History" section
- Click "Add Salary Record"
- Enter:
  - Base Salary
  - Allowances (housing, transport, etc.)
  - Deductions (insurance, tax, etc.)
  - Effective Date
  - Payment Cycle (monthly/biweekly/weekly)

**Step 5: Upload Documents**
- In employee profile, go to "Documents" section
- Click "Upload Document"
- Select document type: Contract, ID, Certificate, Other
- Choose file (PDF, images, etc.)
- Document is securely stored in Vercel Blob

## 🔍 Troubleshooting

### HR Module Not Visible

**Check 1: User Role**
\`\`\`sql
-- Verify your user role in database
SELECT email, role FROM users WHERE email = 'your@email.com';
\`\`\`
- Must be 'ceo' or 'admin'

**Check 2: Clear Browser Cache**
- Hard refresh: Ctrl+Shift+R (Windows) or Cmd+Shift+R (Mac)
- Or clear browser cache and reload

**Check 3: Check Console**
- Open browser DevTools (F12)
- Look for errors in Console tab
- Look for "[v0]" debug messages

### SQL Migration Errors

**Error: "column 'id' does not exist"**
- ✅ FIXED in latest version (078)
- Script now handles missing auth.users gracefully
- FK constraints are added conditionally
- If you see this, re-run the updated script

**Error: "relation already exists"**
- Tables already created
- You can safely skip the migration
- Or drop tables first (WARNING: deletes all HR data):
\`\`\`sql
DROP TABLE IF EXISTS salary_payments CASCADE;
DROP TABLE IF EXISTS employee_documents CASCADE;
DROP TABLE IF EXISTS employee_compensation CASCADE;
DROP TABLE IF EXISTS job_descriptions CASCADE;
DROP TABLE IF EXISTS hr_employees CASCADE;
DROP TABLE IF EXISTS job_positions CASCADE;
DROP TABLE IF EXISTS departments CASCADE;
\`\`\`

### API Errors

**Error: "Failed to fetch employees"**
Check API route exists:
- `/app/api/hr/employees/route.ts` should exist
- Restart dev server if just created

**Error: "Permission denied"**
- RLS policies are active
- Check that user is authenticated
- Verify role in database

## 📊 Sample Data Script

Want to test with sample data? Run this:

\`\`\`sql
-- Insert sample departments
INSERT INTO departments (department_name, department_code, description) VALUES
('Sales', 'SALES', 'Sales and business development team'),
('Operations', 'OPS', 'Operations and logistics'),
('IT', 'IT', 'Information technology'),
('Finance', 'FIN', 'Finance and accounting');

-- Insert sample positions
INSERT INTO job_positions (position_title, department_id, min_salary, max_salary) VALUES
('Sales Manager', 1, 50000, 80000),
('Sales Executive', 1, 30000, 50000),
('Operations Manager', 2, 45000, 70000),
('IT Manager', 3, 60000, 90000),
('Accountant', 4, 35000, 55000);

-- Insert sample employee (adjust user_id if needed, or leave NULL)
INSERT INTO hr_employees (
  employee_number, 
  full_name, 
  email, 
  phone, 
  department_id, 
  position_id, 
  hire_date,
  employment_status
) VALUES (
  'EMP-2025-0001',
  'Ahmed Hassan',
  'ahmed.hassan@company.com',
  '+966501234567',
  1, -- Sales department
  2, -- Sales Executive
  '2024-01-15',
  'active'
);

-- Add compensation for the employee
INSERT INTO employee_compensation (
  employee_id,
  base_salary,
  allowances,
  total_compensation,
  effective_date,
  salary_cycle,
  is_active
) VALUES (
  (SELECT employee_id FROM hr_employees WHERE employee_number = 'EMP-2025-0001'),
  35000,
  5000,
  40000,
  '2024-01-15',
  'monthly',
  true
);

COMMIT;
\`\`\`

## 🎯 Key Features to Test

### ✅ Employee Management
- [ ] Add new employee
- [ ] Edit employee details
- [ ] Change employment status
- [ ] Search/filter employees

### ✅ Compensation Tracking
- [ ] Add salary record
- [ ] View salary history
- [ ] Multiple effective dates
- [ ] Different payment cycles

### ✅ Document Management
- [ ] Upload employee document
- [ ] View document in new tab
- [ ] Multiple documents per employee
- [ ] Different document types

### ✅ Organization Structure
- [ ] Create departments
- [ ] Create positions
- [ ] Link employees to dept/position
- [ ] View organizational hierarchy

### ✅ Security & Access Control
- [ ] CEO can view all employees
- [ ] Admin can manage HR data
- [ ] API enforces role checks
- [ ] Documents are secure (Blob storage)

## 📝 Notes

- **Employee Numbers**: Auto-generated in format EMP-YYYY-XXXX
- **Document Storage**: Uses Vercel Blob (same as PO invoices)
- **Role-Based Access**: Enforced at API level (not RLS)
- **Bilingual**: Full English/Arabic support
- **Isolated**: No dependencies on other ERP modules
- **Production Ready**: Complete with audit trails, validations, and error handling

## 🆘 Still Having Issues?

1. Check browser console for errors
2. Verify database tables were created
3. Check API routes are accessible
4. Ensure user role is 'ceo' or 'admin'
5. Try logging out and back in

---

**Last Updated:** January 2025
**Version:** 1.0
**Status:** Production Ready ✅
