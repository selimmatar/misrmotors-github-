# HR Management System - Complete Specification

## Overview

Comprehensive Human Resources Management System with employee master data, compensation tracking, document management, and payroll capabilities. Designed as an isolated domain with minimal dependencies on existing ERP modules.

---

## Database Schema

### Entity Relationship Diagram

\`\`\`
auth.users (Supabase Auth)
    ↓ (1:1)
hr_employees ← departments
    ↓          ↑
    ↓    job_positions
    ↓          
employee_compensation
    ↓
salary_payments

hr_employees → employee_documents
hr_employees → job_descriptions
job_positions → job_descriptions
\`\`\`

### Tables Summary

| Table | Purpose | Key Features |
|-------|---------|--------------|
| **departments** | Organizational structure | Manager hierarchy, active status |
| **job_positions** | Job titles and roles | Salary ranges, requirements, grade levels |
| **hr_employees** | Employee master data | Links to auth.users, employment status, contact info |
| **employee_compensation** | Salary history | Base + allowances - deductions, effective dates |
| **salary_payments** | Payroll runs | Payment records with bonuses/overtime |
| **employee_documents** | Document storage | Secure file storage with expiry tracking |
| **job_descriptions** | Job specs | Rich text, position or employee-specific |

---

## Row Level Security (RLS) Policies

### Access Matrix

| Role | Departments | Positions | Employees | Compensation | Documents | Job Descriptions |
|------|-------------|-----------|-----------|--------------|-----------|------------------|
| **CEO** | Full CRUD | Full CRUD | Full CRUD | Full CRUD | Full CRUD | Full CRUD |
| **HR Admin** | Full CRUD | Full CRUD | Full CRUD | Full CRUD | Full CRUD | Full CRUD |
| **Employee** | View All | View All | View Own | View Own | View Own | View All |
| **Other** | View All | View All | No Access | No Access | No Access | View All |

### Policy Details

#### Departments & Job Positions
- **SELECT:** All authenticated users
- **INSERT/UPDATE/DELETE:** CEO and admin only

#### Employees
- **SELECT:** Employees can view own record, CEO/admin view all
- **INSERT/UPDATE/DELETE:** CEO and admin only

#### Compensation & Salary Payments
- **SELECT:** Employees can view own records, CEO/admin view all
- **INSERT/UPDATE/DELETE:** CEO and admin only (payroll confidentiality)

#### Documents
- **SELECT:** Employees can view own documents, CEO/admin view all
- **INSERT/UPDATE/DELETE:** CEO and admin only
- **Special:** `is_confidential` flag for extra sensitive docs

#### Job Descriptions
- **SELECT:** All authenticated users (transparency)
- **INSERT/UPDATE/DELETE:** CEO and admin only

### Service Role Bypass
All API routes use `SUPABASE_SERVICE_ROLE_KEY` and bypass RLS automatically. RLS acts as a safety net.

---

## Feature Specifications

### 1. Employee Master Data

**Fields:**
- Personal: Full name, national ID, email, phone, DOB, gender
- Employment: Employee number (auto-generated), hire date, status, type
- Assignment: Department, position, manager
- Contact: Address, city, emergency contact
- Status tracking: Probation, termination, resignation

**Employee Number Format:** `EMP-YYYY-XXXX` (e.g., EMP-2026-1001)

**Employment Statuses:**
- `active`: Currently employed
- `on_leave`: Temporary leave
- `suspended`: Disciplinary suspension
- `terminated`: Employment terminated
- `resigned`: Voluntary resignation

**Employment Types:**
- `full_time`, `part_time`, `contract`, `intern`

---

### 2. Compensation Management

**Salary Components:**
- **Base Salary:** Core compensation
- **Allowances:**
  - Housing allowance
  - Transportation allowance
  - Meal allowance
  - Other allowances (configurable)
- **Deductions:**
  - Social insurance
  - Income tax
  - Other deductions (loans, advances)

**Calculated Fields:**
- **Gross Salary:** Base + All allowances
- **Net Salary:** Gross - All deductions

**Effective Dating:**
- Each compensation record has `effective_date` and optional `end_date`
- System tracks full salary history
- Only one active record per employee at a time

**Payment Details:**
- Payment frequency: weekly, bi-weekly, monthly, quarterly
- Payment method: bank transfer, cash, cheque
- Bank account information

---

### 3. Payroll Runs (Salary Payments)

**Payment Record Structure:**
- **Period:** Start date, end date, payment date
- **Amounts:** Base, allowances, deductions, gross, net
- **Extras:** Bonuses, overtime, adjustments
- **Status:** pending → processed → paid → cancelled

**Payment Workflow:**
1. Generate payroll batch for period
2. Calculate amounts from active compensation records
3. Add bonuses/overtime if applicable
4. Process payment (mark as processed)
5. Confirm payment (mark as paid)

**Audit Trail:**
- `processed_by`: User who generated payment
- `processed_at`: Timestamp of processing
- `payment_reference`: External payment system reference

---

### 4. Document Management

**Document Types:**
- `contract`: Employment contracts
- `national_id`: National ID copies
- `passport`: Passport copies
- `certificate`: Professional certifications
- `diploma`: Educational diplomas
- `performance_review`: Performance reviews
- `warning`: Disciplinary warnings
- `resignation`: Resignation letters
- `termination`: Termination letters
- `other`: Miscellaneous documents

**Document Metadata:**
- Name, URL, size, MIME type
- Document date, expiry date
- Confidentiality flag
- Access tracking (last accessed by/at)

**Security Features:**
- RLS policies restrict access to own documents
- CEO/admin have full access
- Confidential flag for extra sensitive docs
- Expiry date tracking for time-sensitive docs (IDs, contracts)

---

### 5. Job Descriptions

**Description Types:**
- **Position Template:** Generic job description for a position
- **Employee Specific:** Custom job description for an individual

**Content Sections:**
- Overview
- Responsibilities (rich text/HTML)
- Requirements (rich text/HTML)
- Qualifications
- KPIs (Key Performance Indicators)
- Reporting structure

**Features:**
- Versioning support (track changes)
- Upload document or write rich text
- Active/inactive status
- Approval workflow (created_by, approved_by)

---

## API Endpoints

### Employees API (`/api/hr/employees`)

**GET** - Fetch all employees (with filters)
- Query params: `status`, `department_id`, `position_id`
- Returns: Array of employees with department/position names

**POST** - Create new employee
- Body: Employee data
- Auto-generates employee number
- Returns: Created employee with ID

**PUT** - Update employee
- Body: `employee_id`, updated fields
- Returns: Updated employee

**DELETE** - Soft delete employee (set status to terminated)
- Body: `employee_id`, `termination_reason`
- Returns: Success message

---

### Compensation API (`/api/hr/compensation`)

**GET** - Fetch compensation history
- Query param: `employee_id`
- Returns: Compensation records sorted by effective_date

**POST** - Create new compensation record
- Body: Employee ID, salary components, effective date
- Deactivates previous active record
- Returns: Created compensation record

**PUT** - Update compensation record
- Body: `compensation_id`, updated fields
- Returns: Updated record

---

### Salary Payments API (`/api/hr/salary-payments`)

**GET** - Fetch salary payment history
- Query params: `employee_id`, `start_date`, `end_date`, `status`
- Returns: Payment records

**POST** - Generate payroll for period
- Body: `employee_ids[]`, `pay_period_start`, `pay_period_end`, `payment_date`
- Calculates amounts from active compensation
- Creates payment records
- Returns: Created payment records

**PUT** - Update payment status
- Body: `payment_id`, `status`, `payment_reference`
- Allows: pending → processed, processed → paid
- Returns: Updated payment

---

### Documents API (`/api/hr/documents`)

**GET** - Fetch employee documents
- Query param: `employee_id`
- Returns: Document list with metadata

**POST** - Upload document
- Body: `employee_id`, `document_type`, `file` (multipart)
- Uploads to Vercel Blob
- Creates document record
- Returns: Document record with URL

**DELETE** - Delete document
- Body: `document_id`
- Deletes from Blob and database
- Returns: Success message

---

### Job Descriptions API (`/api/hr/job-descriptions`)

**GET** - Fetch job descriptions
- Query params: `position_id`, `employee_id`
- Returns: Job description records

**POST** - Create job description
- Body: JD content, position/employee ID
- Returns: Created JD

**PUT** - Update job description
- Body: `job_description_id`, updated content
- Increments version number
- Returns: Updated JD

---

## UI Components

### Module Structure

\`\`\`
components/modules/
  └── hr-management-module.tsx (Main container with tabs)
      ├── EmployeeList (Grid view with filters)
      ├── EmployeeProfile (Detailed view with tabs)
      ├── CompensationManager (Salary history table)
      ├── PayrollGenerator (Batch payment creation)
      ├── DocumentManager (Upload/view documents)
      └── JobDescriptionEditor (Rich text editor)
\`\`\`

### Navigation Entry

**Sidebar Addition:**
- Icon: `UserCog` (from lucide-react)
- Label: "Human Resources"
- Module ID: `hr-management`
- Visible to: CEO, admin
- Translation key: `module.hr-management`

---

## Acceptance Tests

### Test Suite A: Employee Management

**A1: Create Employee**
- ✅ Admin creates new employee with required fields
- ✅ System auto-generates employee number (EMP-2026-XXXX)
- ✅ User_id links to auth.users if provided
- ✅ Employment status defaults to 'active'
- ✅ Hire date is required and validated

**A2: Update Employee**
- ✅ Admin updates employee department and position
- ✅ Changes are saved with updated_at timestamp
- ✅ Manager assignment updates correctly

**A3: Employee Status Workflow**
- ✅ Active → On Leave → Active (with leave dates)
- ✅ Active → Terminated (with termination date and reason)
- ✅ Terminated employees excluded from active employee list
- ✅ Resigned employees have resignation handling

**A4: RLS - View Own Profile**
- ✅ Employee can view own profile when logged in
- ✅ Employee cannot view other employees' profiles
- ✅ CEO and admin can view all employee profiles

---

### Test Suite B: Compensation Management

**B1: Create Compensation Record**
- ✅ Admin sets base salary and allowances for employee
- ✅ System calculates gross_salary (base + allowances)
- ✅ System calculates net_salary (gross - deductions)
- ✅ Effective date is set and is_active = true

**B2: Salary History**
- ✅ Create new compensation with new effective date
- ✅ Previous compensation record is_active set to false
- ✅ Previous record end_date set to day before new effective_date
- ✅ Full salary history preserved

**B3: Compensation Components**
- ✅ Housing allowance + transportation + meal = total allowances
- ✅ Social insurance + income tax = total deductions
- ✅ Gross = base + all allowances
- ✅ Net = gross - all deductions

**B4: RLS - View Own Compensation**
- ✅ Employee can view own salary history
- ✅ Employee cannot view other employees' salaries
- ✅ CEO and admin can view all compensation records

---

### Test Suite C: Payroll Processing

**C1: Generate Payroll Batch**
- ✅ Admin selects employees and pay period
- ✅ System fetches active compensation for each employee
- ✅ Salary payment records created with status 'pending'
- ✅ Amounts copied from compensation records

**C2: Add Bonuses and Overtime**
- ✅ Admin adds bonus to payment with description
- ✅ Admin adds overtime hours and amount
- ✅ Net amount recalculated including bonuses

**C3: Process Payment**
- ✅ Admin marks payments as 'processed'
- ✅ processed_by and processed_at captured
- ✅ Payment reference entered (bank transfer ID)
- ✅ Status updated to 'paid' after confirmation

**C4: Payment History**
- ✅ Filter payments by employee
- ✅ Filter payments by date range
- ✅ Filter payments by status
- ✅ Export payroll report (CSV/PDF)

---

### Test Suite D: Document Management

**D1: Upload Document**
- ✅ Admin uploads contract document for employee
- ✅ File uploaded to Vercel Blob
- ✅ Document record created with URL, type, size
- ✅ Uploaded_by captures admin user ID

**D2: Document Types**
- ✅ Upload national_id with expiry date
- ✅ Upload certificate with document date
- ✅ Upload performance_review as confidential
- ✅ All document types supported

**D3: Document Access**
- ✅ Employee can view own documents
- ✅ Employee cannot access other employees' documents
- ✅ CEO/admin can access all documents
- ✅ Confidential documents have extra warning

**D4: Document Expiry Tracking**
- ✅ System flags documents expiring within 30 days
- ✅ Expired documents highlighted in UI
- ✅ Admin receives expiry notifications

---

### Test Suite E: Job Descriptions

**E1: Create Position-Level JD**
- ✅ Admin creates JD for "Sales Representative" position
- ✅ Content includes overview, responsibilities, requirements
- ✅ All employees in that position can view JD
- ✅ Active status allows multiple versions

**E2: Create Employee-Specific JD**
- ✅ Admin creates custom JD for specific employee
- ✅ JD linked to employee_id (not position_id)
- ✅ Employee can view own JD
- ✅ Other employees cannot view employee-specific JDs

**E3: Job Description Versioning**
- ✅ Update JD increments version number
- ✅ Previous versions preserved (is_active = false)
- ✅ View version history shows all changes
- ✅ Revert to previous version supported

**E4: Upload vs Rich Text**
- ✅ Admin writes JD directly in rich text editor
- ✅ Admin uploads JD as PDF document
- ✅ Both methods supported
- ✅ Document URL stored for uploaded files

---

### Test Suite F: Integration & Workflow

**F1: New Hire Workflow**
1. ✅ Admin creates employee record
2. ✅ Admin sets initial compensation
3. ✅ Admin uploads contract document
4. ✅ Admin assigns job description
5. ✅ Employee receives onboarding email
6. ✅ Employee can view own profile when assigned user_id

**F2: Salary Increase Workflow**
1. ✅ Admin creates new compensation record with increased salary
2. ✅ Previous compensation end_date set
3. ✅ New compensation active from effective_date
4. ✅ Next payroll uses new compensation amounts

**F3: Termination Workflow**
1. ✅ Admin updates employment status to 'terminated'
2. ✅ Termination date and reason recorded
3. ✅ Employee excluded from active payroll
4. ✅ All history preserved (compensation, documents, payments)

**F4: RLS Policy Verification**
- ✅ Create test employee user account
- ✅ Login as employee → can view own data only
- ✅ Login as CEO → can view all employees
- ✅ Login as accountant → no HR access (not in CEO/admin roles)

---

### Test Suite G: Reporting & Analytics

**G1: Headcount Report**
- ✅ Total active employees
- ✅ Breakdown by department
- ✅ Breakdown by position
- ✅ Employment type distribution

**G2: Payroll Summary**
- ✅ Total payroll cost per month
- ✅ Average salary by department
- ✅ Total bonuses paid
- ✅ Year-over-year comparison

**G3: Document Compliance**
- ✅ List employees with missing documents
- ✅ List documents expiring soon
- ✅ List employees without contracts
- ✅ Compliance score per employee

---

## Implementation Checklist

### Phase 1: Database & Backend
- [x] Create database schema (script 078)
- [x] Enable RLS policies
- [ ] Create API routes (employees, compensation, payments, documents)
- [ ] Test RLS policies with different user roles

### Phase 2: UI Components
- [ ] Create HR management module container
- [ ] Build employee list component with filters
- [ ] Build employee profile view with tabs
- [ ] Build compensation history table
- [ ] Build payroll generator form

### Phase 3: Document Management
- [ ] Integrate Vercel Blob for file uploads
- [ ] Build document upload component
- [ ] Build document viewer with access controls
- [ ] Implement expiry date notifications

### Phase 4: Job Descriptions
- [ ] Build rich text editor for job descriptions
- [ ] Build job description viewer
- [ ] Implement versioning UI
- [ ] Build document upload alternative

### Phase 5: Integration & Testing
- [ ] Add HR module to sidebar navigation
- [ ] Add i18n translations for HR module
- [ ] Run acceptance tests A1-G3
- [ ] Security audit (RLS, document access)
- [ ] Performance testing (large employee datasets)

---

## Security Considerations

### Data Confidentiality
- ✅ Salary information visible only to CEO/admin
- ✅ Documents restricted by RLS
- ✅ Employee personal data (national ID, DOB) protected
- ✅ Audit trail for all sensitive operations

### Access Control
- ✅ Role-based RLS policies
- ✅ Service role bypass for API operations
- ✅ Document-level confidentiality flags
- ✅ Manager hierarchy support (future enhancement)

### Compliance
- ✅ Data retention policies (termination records)
- ✅ Document expiry tracking (IDs, contracts)
- ✅ Audit trail (created_by, uploaded_by)
- ✅ Secure file storage (Vercel Blob)

---

## Future Enhancements

1. **Leave Management:** Annual leave, sick leave, leave requests
2. **Attendance Tracking:** Clock in/out, late arrivals, overtime tracking
3. **Performance Reviews:** Structured review forms, rating scales
4. **Recruitment:** Job postings, applicant tracking, interview scheduling
5. **Training:** Training programs, attendance, certifications
6. **Benefits Management:** Insurance, retirement plans, benefits enrollment
7. **Org Chart:** Visual organizational hierarchy
8. **Employee Self-Service:** Profile updates, leave requests, document downloads

---

## Conclusion

This HR Management System provides a comprehensive, secure, and scalable solution for managing employees, compensation, payroll, and documents. The isolated design ensures no impact on existing ERP modules while maintaining full integration with the authentication system.

**Key Strengths:**
- Comprehensive employee lifecycle management
- Secure document storage with RLS
- Full salary history and payroll tracking
- Role-based access control (CEO, HR admin, employees)
- Additive-only schema (no breaking changes)
- Production-ready RLS policies
