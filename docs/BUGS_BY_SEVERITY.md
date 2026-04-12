# Bugs Found - Grouped by Severity

## P0 - Critical (Blocks Core Workflow)

### BUG-001: AP Payment Update Fails with "invoice_id undefined"
**Status**: FIXED
**Reproduction**:
1. Create PO with hybrid payment
2. Approve PO (CEO)
3. Go to Accounts Payable
4. Click View Schedule → Record Payment
5. Error: "invoice_id eq.undefined"

**Root Cause**: `updateSupplierInvoice` sent `{ invoiceId, ...updates }` but API expected `{ id, ...updates }`
**Fix**: Changed to `{ id: invoiceId, ...updates }` in app-context.tsx

---

### BUG-002: PO Creation Fails - "po_number null"
**Status**: FIXED
**Reproduction**:
1. Fill out PO form
2. Click Save
3. Error: "null value in column po_number"

**Root Cause**: `addPurchaseOrder` in app-context was missing `po_number` field
**Fix**: Added `po_number: order.poNumber` to request body

---

### BUG-003: PO Approval Fails - "po_id eq.undefined"
**Status**: FIXED
**Reproduction**:
1. Create PO
2. Login as CEO
3. Click Approve
4. Error: "po_id eq.undefined"

**Root Cause**: `updatePurchaseOrder` sent `po_id` but API expected `id`
**Fix**: Changed to `id: order.id` in app-context.tsx

---

## P1 - High (Major Feature Broken)

### BUG-004: Down Payment Amount Recalculated from Percentage
**Status**: FIXED
**Reproduction**:
1. Create SO/PO with hybrid payment
2. Enter down payment amount: 20000
3. Change another field
4. Down payment becomes calculated value (e.g., 20051.56)

**Root Cause**: `HybridFields` component sent both amount and percent on each change, triggering recalculation
**Fix**: Modified to only send the field user actually changed

---

### BUG-005: Cheque Fields Not Accepting Input
**Status**: FIXED
**Reproduction**:
1. Select Cheque payment type
2. Try to type in cheque number field
3. Nothing happens

**Root Cause**: Field mapping was incorrect, onChange handlers not properly bound
**Fix**: Rewrote `ChequeFields` component with proper event handlers

---

### BUG-006: Low Stock Suggestions Show Items Already in PO
**Status**: FIXED
**Reproduction**:
1. Create PO with low-stock items
2. Get PO approved
3. Low stock widget still shows same items

**Root Cause**: Filter only checked current form items, not existing POs
**Fix**: Added filter for items in pending/approved POs

---

## P2 - Medium (Feature Works with Issues)

### BUG-007: Schedule Rounding May Cause Cent Discrepancy
**Status**: PARTIAL FIX
**Reproduction**:
1. Create invoice for 1000 EGP with 3 installments
2. Each installment: 333.33
3. Total: 999.99 (1 cent short)

**Root Cause**: Division without rounding adjustment
**Fix**: Added rounding adjustment in schedule generation

---

### BUG-008: Payment Progress Bar Not Updating
**Status**: FIXED
**Reproduction**:
1. Record payment in AP
2. Payment marked as paid
3. Progress bar stays at 0%

**Root Cause**: Local state not refreshed after successful payment
**Fix**: Added state refresh and loadData call after payment

---

### BUG-009: Balance Column is Generated (Cannot Update)
**Status**: FIXED
**Reproduction**:
1. Try to update AR invoice with balance field
2. Error: "balance can only be updated to DEFAULT"

**Root Cause**: Code tried to update auto-calculated column
**Fix**: Removed balance from update objects in AR API and module

---

### BUG-010: JSON.JSON.stringify Typo
**Status**: FIXED
**Location**: accounts-receivable-module.tsx
**Root Cause**: Typo in debug logging
**Fix**: Changed to JSON.stringify

---

## P3 - Low (Minor/Cosmetic)

### BUG-011: Debug Console Logs in Production
**Status**: NEEDS CLEANUP
**Location**: Multiple modules
**Fix**: Remove [v0] debug logs before production

---

### BUG-012: Product Category Not Linked to DB
**Status**: FIXED
**Reproduction**: Categories entered but not saved
**Fix**: Added category selection from existing + custom input option
