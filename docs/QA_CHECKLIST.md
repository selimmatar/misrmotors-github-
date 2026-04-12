# QA Checklist - Misr Motors ERP

## Pre-Test Setup

- [ ] Clear browser cache and cookies
- [ ] Note starting inventory levels
- [ ] Note starting AR/AP balances

---

## 1. Sales Order Workflow

### 1.1 Create Sales Order
- [ ] Login as **Sales Rep**
- [ ] Navigate to Sales Orders
- [ ] Click "Create New SO"
- [ ] Select a customer
- [ ] Add products (verify stock shown)
- [ ] Try to add more than available stock → **Should fail**
- [ ] Add valid quantity
- [ ] Select payment type: **Hybrid**
- [ ] Enter down payment amount
- [ ] Set installment count and dates
- [ ] Click Manual mode → Set custom amounts per month
- [ ] Save order
- [ ] **Expected:** Order created, inventory reserved

### 1.2 Generate Delivery Permit
- [ ] Login as **Warehouse Rep**
- [ ] Navigate to Warehouse Delivery
- [ ] Find the new SO
- [ ] Click "Ready for Collection"
- [ ] **Expected:** DP status changes to READY_FOR_DELIVERY

### 1.3 Ship Order
- [ ] Login as **Shipment**
- [ ] Navigate to Shipping
- [ ] Find the ready DP
- [ ] Select a courier from dropdown
- [ ] Click "Mark Out for Delivery"
- [ ] Print DP (optional)
- [ ] **Expected:** DP status changes to OUT_FOR_DELIVERY

### 1.4 Submit Signed DP
- [ ] Upload a signed document
- [ ] Click "Submit Signed"
- [ ] **Expected:** DP status changes to SUBMITTED_SIGNED

### 1.5 Create AR Invoice
- [ ] Login as **Accountant**
- [ ] Navigate to Delivery Permits
- [ ] Find the signed DP
- [ ] Click "Review & Approve"
- [ ] Verify DP details and signed document
- [ ] Click "Create Invoice"
- [ ] **Expected:** AR invoice created, SO status = delivered

### 1.6 Verify Payment Schedule
- [ ] Navigate to Accounts Receivable
- [ ] Find the new invoice
- [ ] Click "View Schedule"
- [ ] **Expected:** 
  - Down payment shown as first entry
  - Custom amounts/dates match what was entered
  - Progress bar at 0%

### 1.7 Record Payment
- [ ] Click "Record Payment" on down payment row
- [ ] Enter payment details
- [ ] Submit
- [ ] **Expected:** 
  - Down payment marked as PAID
  - Progress bar updated
  - Invoice collected amount updated

---

## 2. Purchase Order Workflow

### 2.1 Create Purchase Order
- [ ] Login as **PO Rep**
- [ ] Navigate to Purchase Orders
- [ ] Click "Create New PO"
- [ ] Select PO Type: **International**
- [ ] Select a supplier
- [ ] Add products
- [ ] Select payment type: **Hybrid**
- [ ] Enter down payment (amount, not percent)
- [ ] Set installment schedule
- [ ] Use Manual mode for custom amounts
- [ ] Save order
- [ ] **Expected:** PO created with status "pending"

### 2.2 CEO Approval
- [ ] Login as **CEO**
- [ ] Navigate to Purchase Orders
- [ ] Find the pending PO
- [ ] Click "Approve"
- [ ] **Expected:** 
  - PO status = approved
  - AP invoice created
  - Payment schedules created

### 2.3 Verify AP Schedule
- [ ] Navigate to Accounts Payable
- [ ] Find the new invoice
- [ ] Click "View Schedule"
- [ ] **Expected:**
  - Down payment shown first
  - Custom amounts/dates match input
  - Progress bar at 0%

### 2.4 Receive Goods
- [ ] Login as **Warehouse Rep**
- [ ] Navigate to Goods Receipt
- [ ] Find the approved PO
- [ ] Select receiving warehouse
- [ ] Accept receipt
- [ ] **Expected:**
  - PO status = received
  - Inventory quantities increased
  - Batch record created

### 2.5 Record AP Payment
- [ ] Login as **Accountant**
- [ ] Navigate to Accounts Payable
- [ ] Open payment schedule
- [ ] Record payment on down payment
- [ ] **Expected:**
  - Payment marked as PAID
  - Progress bar updated

---

## 3. Inventory Management

### 3.1 Stock Levels
- [ ] Login as **Warehouse Rep**
- [ ] Navigate to Inventory
- [ ] Verify stock levels reflect SO deductions and PO additions
- [ ] Check warehouse filter works

### 3.2 Inventory Audit
- [ ] Navigate to Inventory Audit
- [ ] Perform a count
- [ ] Enter physical count different from system
- [ ] Submit audit
- [ ] **Expected:** Inventory adjusted, audit record created

---

## 4. Dashboard & Analytics

### 4.1 Financial Dashboard
- [ ] Login as **CEO**
- [ ] Navigate to Dashboard
- [ ] Verify metrics load without errors
- [ ] Check Revenue matches sum of delivered SOs
- [ ] Check AR Outstanding matches unpaid invoices
- [ ] Check AP Outstanding matches unpaid bills

### 4.2 Analytics
- [ ] Navigate to Analytics
- [ ] Check charts render correctly
- [ ] Verify no "0" or placeholder data

---

## 5. System Health

### 5.1 Health Check
- [ ] Login as **Admin** or **CEO**
- [ ] Navigate to System Health
- [ ] Click "Run Health Check"
- [ ] **Expected:** All checks pass (green)
- [ ] If any fail, investigate and resolve

---

## 6. Edge Cases

### 6.1 Insufficient Stock
- [ ] Try to create SO with quantity > stock
- [ ] **Expected:** Error message, order not created

### 6.2 Duplicate Prevention
- [ ] Try to approve already approved PO
- [ ] **Expected:** Button disabled or error

### 6.3 Invalid Dates
- [ ] Try to set payment start date in past
- [ ] **Expected:** Validation prevents or warns

---

## Test Results

| Test | Pass/Fail | Notes |
|------|-----------|-------|
| SO Create | | |
| SO Delivery | | |
| SO Invoice | | |
| AR Payment | | |
| PO Create | | |
| PO Approve | | |
| PO Receive | | |
| AP Payment | | |
| Inventory | | |
| Dashboard | | |
| System Health | | |

**Tested By:** _______________  
**Date:** _______________  
**Environment:** _______________
