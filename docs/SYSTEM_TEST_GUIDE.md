# Water Pump ERP System - Comprehensive Test Guide

This guide will help you test the entire system with fictional data to ensure everything works properly.

## Prerequisites

1. Run the SQL scripts in order:
   - `scripts/09-new-schema-with-integer-ids.sql` (create tables)
   - `scripts/10-seed-test-data.sql` (load test data)

2. Log in with test users:
   - **CEO**: ceo@misrmotors.com / ceo123
   - **Accountant**: accountant@misrmotors.com / acc123
   - **Sales Rep**: sales@misrmotors.com / sales123
   - **PO Rep**: po@misrmotors.com / po123
   - **Warehouse Rep**: warehouse@misrmotors.com / warehouse123
   - **Shipment**: shipment@misrmotors.com / ship123

## Test Scenarios

### 1. Product Management
**Role**: Any user

1. Navigate to Products module
2. Verify 8 products are loaded
3. Add a new product:
   - Name: "Industrial Pump 7.5HP"
   - SKU: "IP-75HP-009"
   - Category: "Water Pumps"
   - Unit Price: 4500
   - MOQ: 2
   - Desired Excess: 15
4. Verify product appears in the list
5. Check inventory shows correct stock levels

### 2. Customer Management
**Role**: Sales Rep or Admin

1. Navigate to Customers module
2. Verify 4 customers are loaded
3. Click on "Ahmed Construction LLC"
4. Verify customer details and purchase history
5. Add a new customer:
   - Name: "Delta Farms Corporation"
   - Email: "purchasing@deltafarms.com"
   - Phone: "01234567890"
   - Country: "Egypt"
   - City: "Port Said"
6. Verify customer is created

### 3. Supplier Management
**Role**: PO Rep or Admin

1. Navigate to Suppliers module
2. Verify 3 suppliers are loaded
3. Add a new supplier:
   - Name: "Modern Hydraulics Ltd"
   - Email: "sales@modernhydraulics.com"
   - Phone: "01098765432"
   - Country: "Egypt"
   - City: "Cairo"
   - Payment Terms: "installment"
4. Verify supplier is created

### 4. Purchase Order Workflow
**Role**: PO Rep → CEO

#### As PO Rep:
1. Navigate to Purchase Orders module
2. Verify existing POs are visible
3. Create a new PO:
   - Supplier: "Global Pump Manufacturing Co."
   - Due Date: Next month
   - Currency: "EGP"
   - Payment Method: "Installment" (3 months)
   - Items:
     - Centrifugal Pump 5HP, Qty: 5, Price: 3200
     - Electric Motor 5HP, Qty: 3, Price: 1500
4. Save the PO
5. Verify PO appears with "Pending" status

#### As CEO:
1. Log out and log in as CEO
2. Navigate to Purchase Orders
3. Find the pending PO
4. Click "Approve"
5. Verify:
   - PO status changes to "Approved"
   - A supplier invoice is created in AP module

### 5. Sales Order Workflow
**Role**: Sales Rep → Accountant → Warehouse → Shipment

#### As Sales Rep:
1. Navigate to Sales Orders module
2. Create a new SO:
   - Customer: "Ahmed Construction LLC"
   - Due Date: Next month
   - Payment Method: "Installment" (3 months)
   - Items:
     - Submersible Pump 3HP, Qty: 3, Price: 2800
     - Pump Controller Unit, Qty: 5, Price: 450
3. Save the SO
4. Verify SO appears with "Pending Accountant" status

#### As Accountant:
1. Log out and log in as Accountant
2. Navigate to Accountant module
3. Find the pending SO
4. Upload an invoice PDF/image
5. Click "Approve SO"
6. Verify:
   - SO status changes to "Accountant Approved"
   - A customer invoice is created in AR module

#### As Warehouse Rep:
1. Log out and log in as Warehouse Rep
2. Navigate to Inventory module
3. Find the approved SO
4. Click "Prepare for Shipment"
5. Verify SO status changes to "Ready for Delivery"

#### As Shipment:
1. Log out and log in as Shipment
2. Navigate to Shipping module
3. Find the SO ready for delivery
4. Upload a shipping invoice
5. Click "Mark as Shipped"
6. Verify SO status changes to "Shipped"

### 6. Accounts Payable (AP)
**Role**: Accountant

1. Navigate to Accounts Payable module
2. Verify supplier invoices from approved POs
3. Find an installment invoice
4. Record a payment:
   - Amount: (1/3 of total)
   - Payment Method: "Bank Transfer"
   - Reference: "PAY-TEST-001"
5. Verify:
   - Payment is recorded
   - Months paid increases
   - Balance decreases
   - Status updates if fully paid

### 7. Accounts Receivable (AR)
**Role**: Accountant

1. Navigate to Accounts Receivable module
2. Verify customer invoices from approved SOs
3. Find an installment invoice
4. Record a payment:
   - Amount: (1/installment months of total)
   - Payment Method: "Bank Transfer"
   - Reference: "PAY-CUST-TEST-001"
5. Verify:
   - Payment is recorded
   - Months paid increases
   - Balance decreases
   - Status updates when fully paid

### 8. Dashboard Verification
**Role**: CEO

1. Navigate to Dashboard
2. Verify all metrics are displayed:
   - Total Sales
   - Total Purchase Orders
   - Inventory Value
   - Customer Count
3. Verify charts show:
   - Sales vs Purchase trend
   - Top products by revenue
   - Customer distribution
4. Check that numbers match the actual data

### 9. Inventory Tracking
**Role**: Warehouse Rep

1. Navigate to Inventory module
2. Verify stock levels for all products
3. Look for low stock alerts (items below desired excess)
4. Check inventory transactions history
5. Verify deductions from sales orders are recorded

### 10. Financial Dashboard
**Role**: Accountant or CEO

1. Navigate to Financial Dashboard
2. Verify:
   - Total AR (Accounts Receivable)
   - Total AP (Accounts Payable)
   - Net Position
3. Check overdue invoices are highlighted
4. Verify payment schedules match invoice terms

## Expected Results Summary

After running all tests with the seed data:

- **3 Suppliers** with contacts
- **4 Customers** with contacts
- **8 Products** across 4 categories
- **8 Inventory items** with realistic stock levels
- **3 Purchase Orders** (1 pending, 2 approved)
- **4 Sales Orders** (various statuses showing workflow)
- **2 Supplier Invoices** in AP
- **3 Customer Invoices** in AR
- **Multiple payment records** showing installment tracking
- **5 Inventory transactions** showing stock movements

## Common Issues & Solutions

### Issue: "Row violates check constraint"
**Solution**: Ensure enum values match database schema:
- Payment terms: 'prepaid' or 'installment' (not '30 days')
- Status values match exactly what's defined in constraints

### Issue: "Multiple GoTrueClient instances"
**Solution**: This is a warning, not an error. The singleton pattern in `lib/supabase/admin.ts` handles it properly.

### Issue: "Duplicate React keys"
**Solution**: All select options now use unique keys with index suffixes.

### Issue: Sales don't reflect in AR
**Solution**: Sales orders must be approved by the Accountant first. The invoice is created during accountant approval, not warehouse preparation.

## Testing Checklist

- [ ] Products CRUD operations work
- [ ] Customers CRUD operations work
- [ ] Suppliers CRUD operations work
- [ ] Purchase Order creation and approval flow
- [ ] Sales Order creation and multi-step approval
- [ ] Inventory deduction on sales
- [ ] Supplier invoice creation on PO approval
- [ ] Customer invoice creation on SO approval
- [ ] AP payment recording
- [ ] AR payment recording
- [ ] Dashboard displays correct metrics
- [ ] Financial dashboard shows accurate balances
- [ ] Low stock alerts appear
- [ ] Invoice printing works
- [ ] File uploads work (invoices)

## Notes

- All currency amounts are in the currency specified (EGP, USD, or EUR)
- Installment payments are tracked month by month
- Stock levels automatically update when sales orders are created
- The system enforces role-based permissions
- All operations are logged to the browser console with `[v0]` prefix for debugging
