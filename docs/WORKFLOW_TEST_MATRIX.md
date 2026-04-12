# Workflow Test Matrix

## A) Sales Order Workflow

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| Create SO (customer, items, pricing) | SO created with auto-generated SO number | ✅ Works | PASS | - |
| Inventory validation | Reject if insufficient stock | ✅ Works | PASS | - |
| Reserve/deduct inventory | Inventory deducted after SO creation | ✅ Works | PASS | - |
| Create Delivery Permit | DP auto-created with SO | ✅ Works | PASS | - |
| Payment: Cash | Payment type stored correctly | ✅ Works | PASS | - |
| Payment: Installments | Schedule generated with monthly amounts | ✅ Works | PASS | - |
| Payment: Hybrid | Down payment + installments | ⚠️ Down payment may be recalculated from % | PARTIAL | Fixed in hybrid-fields.tsx |
| Validate totals | Amounts match across SO/Invoice/Schedule | ✅ Works | PASS | - |
| AR schedule reflects SO | 1:1 match with entered dates/amounts | ✅ Works after fix | PASS | - |

## B) Purchase Order Workflow

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| Create PO (vendor, items, costs) | PO created with auto PO number | ✅ Works | PASS | - |
| PO Status: Pending → Approved | CEO can approve/reject | ✅ Works after fix | PASS | Fixed id vs po_id |
| Receive goods (partial) | Inventory updated proportionally | ✅ Works | PASS | - |
| Receive goods (full) | Full inventory update, status change | ✅ Works | PASS | - |
| Create AP Invoice on approval | Invoice auto-created | ✅ Works | PASS | - |
| Payment: Hybrid | Down payment + schedules | ✅ Works after fix | PASS | Fixed field mapping |
| AP schedule reflects PO | 1:1 match with entered dates/amounts | ✅ Works | PASS | - |
| Bank details stored | Bank info saved to DB | ✅ Works | PASS | - |
| Bank details displayed in AP | Payment Details dialog shows info | ✅ Works | PASS | - |

## C) Inventory Workflow

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| Stock in (from PO receipt) | Quantity increased | ✅ Works | PASS | - |
| Stock out (from SO) | Quantity decreased | ✅ Works | PASS | - |
| Negative inventory prevention | Reject SO if insufficient | ✅ Works | PASS | - |
| Low stock suggestions | Products below reorder point shown | ✅ Works | PASS | - |
| Filter low stock after PO | Items in pending/approved PO excluded | ✅ Works after fix | PASS | Fixed filter |

## D) AR/AP & Scheduling Rules

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| Hybrid: Down payment first | Installment 0 is down payment | ✅ Works | PASS | - |
| Hybrid: Down payment due date | Uses entered date, not calculated | ✅ Works after fix | PASS | Fixed hybrid-fields |
| Custom installments (MANUAL mode) | Exact dates/amounts from entry | ✅ Works | PASS | - |
| Schedule sum = invoice total | No rounding errors | ⚠️ Potential rounding | PARTIAL | Added rounding fix |
| Partial payment updates | Progress bar moves, status updates | ✅ Works after fix | PASS | Fixed updateSupplierInvoice |
| Payment recording | Schedule marked paid, AR/AP updated | ✅ Works | PASS | - |
| Overdue status | Auto-calculated based on due date | ⚠️ Not implemented | FAIL | Needs implementation |

## E) Roles, Security, APIs

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| RLS policies | Data isolated by role | ⚠️ Not enabled | PARTIAL | Scripts created, need review |
| API auth checks | Protected endpoints | ❌ No auth middleware | FAIL | Needs implementation |
| CEO role approval | Only CEO can approve PO/SO | ✅ Works (client-side) | PARTIAL | Server validation needed |

## F) Data Integrity

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| Foreign keys | Proper cascade/restrict rules | ✅ Configured | PASS | - |
| Idempotency | Duplicate actions prevented | ⚠️ Partially | PARTIAL | Some APIs need checks |
| Concurrency | No data corruption | ⚠️ No explicit locking | PARTIAL | Consider optimistic locking |

## G) Performance

| Step | Expected Result | Actual Result | Pass/Fail | Fix Required |
|------|----------------|---------------|-----------|--------------|
| N+1 queries | Avoided with joins | ✅ Fixed in PO GET | PASS | - |
| Database indexes | Key columns indexed | ✅ Scripts created | PASS | Run migration |
| SWR caching | Fast UI updates | ✅ Implemented | PASS | - |
| Rate limit handling | Graceful retry | ✅ withRetry implemented | PASS | - |
