# Payment Schedule Idempotency Fix

## Problem
When creating purchase orders with installment/hybrid payment, the `payment_schedules` table receives duplicate INSERT requests, causing a 409 error:
\`\`\`
duplicate key value violates unique constraint "payment_schedules_invoice_id_installment_number_key"
Key (invoice_id, installment_number)=(45, 1) already exists
\`\`\`

## Root Cause
1. PO is approved → triggers `createSupplierInvoice()`
2. `createSupplierInvoice()` creates AP invoice
3. `createSupplierInvoice()` immediately POSTs to `/api/payment-schedules`
4. If user refreshes or there's a race condition, the same flow triggers again
5. The second POST tries to insert the same `(invoice_id, installment_number)` → 409 error

## Solution Implemented

### 1. Idempotent Schedule Creation (API Level)
**File**: `app/api/payment-schedules/route.ts`
- Before inserting, check if schedules already exist for the given `invoice_id/so_id/po_id`
- If schedules exist, return `200` with `{ alreadyExists: true }` instead of attempting INSERT
- This makes schedule creation safe to retry

### 2. Graceful Client Handling
**File**: `components/modules/purchase-order-module.tsx`
- Check if AP invoice already exists before creating
- Handle `alreadyExists` response from schedule API without throwing error
- Log clear messages for idempotent operations
- Don't fail the entire approval flow if schedules already exist

### 3. Caller Context Logging
Added `x-caller-context` header to track who triggered schedule generation:
- `"PO-approval"` - from PO approval flow
- `"PO-approval-schedule-generation"` - schedule creation after AP invoice
- This helps debug which code path caused duplicate attempts

## Testing
1. **Create PO** with hybrid payment → Approve → ✅ Schedules created
2. **Refresh page quickly** → Try to approve again → ✅ No 409, idempotent skip
3. **Manual schedule regeneration** → Delete + re-create → ✅ Works (future feature)

## Verification
Check logs for:
\`\`\`
[v0] Payment Schedules - Schedules already exist for invoice_id=45, skipping creation (idempotent)
\`\`\`

## Future Enhancement
Add explicit "Regenerate Schedule" button in AP module that:
1. Deletes existing schedules for invoice_id
2. Re-creates with new parameters
3. Wraps in transaction to ensure atomicity
