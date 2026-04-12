# Maintenance Workflow Guide

## Complete End-to-End Workflow

### Step 1: Sales Creates Work Order
**Location:** Sales Order Module → Select a sales order → Maintenance Tab

1. Navigate to Sales Order module
2. Click on any sales order (e.g., SO-2025-115)
3. Go to the "Maintenance" tab
4. Click "Create Work Order"
5. Fill in:
   - Title (e.g., "Oil leak repair")
   - Description
   - Priority
   - Assign to employee (optional)
6. Click "Create"

**What Happens:**
- Work order is created with `status="pending"` and `sales_order_id` linked to the sales order
- Work order appears in Shipping Module → Maintenance Tab

---

### Step 2: Shipping Submits Maintenance Report
**Location:** Shipping Module → Maintenance Tab

1. Go to Shipping module
2. Click "Maintenance" tab (5th tab with wrench icon)
3. See the work order in "My Tasks" section
4. Click "Submit Report"
5. Fill in the report:
   - Findings (what was wrong)
   - Equipment Needed
   - Equipment Cost
   - Labor Hours
   - Labor Cost
   - Total Cost
   - Is Settled checkbox
6. Click "Submit Report"

**What Happens:**
- Maintenance report is created and saved to database
- Work order status changes from `"pending"` to `"on_hold"` (pending sales approval)
- **NO INVOICE is created at this stage**
- Work order moves to "Submitted Reports" tab in Shipping

---

### Step 3: Sales Reviews and Approves
**Location:** Sales Order Module → Maintenance Approvals Tab

1. Go to Sales Order module  
2. Click "Maintenance Approvals" tab (4th tab with wrench icon)
3. See all work orders with `status="on_hold"` (pending approval)
4. Review the report details:
   - Work Order Number
   - Sales Order Number (e.g., SO-2025-115)
   - Customer Name
   - Findings
   - Costs
5. Click "Approve" button

**What Happens:**
- Work order status changes from `"on_hold"` to `"completed"`
- **NO INVOICE is created yet**
- Work order is now ready for accountant to create invoice

---

### Step 4: Accountant Creates Invoice
**Location:** Accountant Module → Maintenance Tab

1. Go to Accountant module
2. Click "Maintenance" tab (9th tab with wrench icon)
3. See all approved work orders with `status="completed"` that don't have invoices yet
4. Review work order details:
   - Work Order Number
   - **Sales Order Number** (should show like SO-2025-115, not "N/A")
   - Customer Name
   - Total Cost
5. Click "Create Invoice" button

**What Happens:**
- AR (Accounts Receivable) entry is created
- Invoice number: `INV-MNT-{report_id}`
- Due date: 30 days from now
- Work order no longer appears in "ready for invoice" list

---

## Current Issues Fixed

### ✅ Work Order Status Flow
- ✅ Pending → On Hold (after report submission) → Completed (after sales approval)
- ✅ Uses only valid database statuses: `pending`, `on_hold`, `completed`

### ✅ Invoice Creation Timing
- ✅ Invoices are NOT created automatically when shipping submits report
- ✅ Invoices are ONLY created manually by accountant after sales approval

### ✅ Sales Order Linking
- ✅ `sales_order_id` is properly saved when work order is created
- ✅ Filter in ready-for-invoice API excludes work orders with null `sales_order_id`
- ✅ Sales order number should display correctly (fixed array handling in API)

---

## Testing the Complete Workflow

1. **Create a work order** from sales order SO-2025-115
2. **Check the logs** - should see:
   ```
   [v0] ========== CREATING MAINTENANCE WORK ORDER ==========
   [v0] Sales Order so_id: 123
   [v0] Request body with salesOrderId: 123
   [v0] ✅ Work order created successfully!
   [v0] Created work order data: { sales_order_id: 123, ... }
   ```

3. **Submit report in shipping** - should see:
   ```
   [v0] ✅ Maintenance report created successfully - awaiting sales approval
   ```

4. **Approve in sales** - should see:
   ```
   [v0] ========== APPROVAL WORKFLOW COMPLETE ==========
   [v0] ✅ Report approved and work order marked as COMPLETED
   [v0] Work Order ID: X - Now ready for INVOICE CREATION in Accounting module
   ```

5. **Check accounting tab** - should see:
   ```
   [v0] ========== FETCHING WORK ORDERS FOR INVOICE CREATION ==========
   [v0] ✅ Fetched X approved work orders ready for invoicing
   [v0] 1. WO-000001 - Sales Order: SO-2025-115 - Customer: Toyota
   ```

---

## Database Schema Reference

### maintenance_work_orders
- `sales_order_id` INTEGER REFERENCES sales_orders(so_id)
- `status` CHECK constraint: `pending`, `assigned`, `in_progress`, `completed`, `cancelled`, `on_hold`

### Workflow Status Mapping
- **pending**: Just created, not started
- **on_hold**: Report submitted, awaiting sales approval
- **completed**: Sales approved, ready for invoice

---

## API Endpoints

- `POST /api/maintenance/work-orders` - Create work order
- `POST /api/maintenance/reports` - Submit report (sets status to on_hold)
- `POST /api/maintenance/reports/approve` - Approve report (sets status to completed)
- `GET /api/maintenance/work-orders/ready-for-invoice` - Get completed work orders without invoices
- `POST /api/maintenance/invoices` - Create invoice for work order
