# Enum/Status Value Mismatch Audit Report

## Executive Summary

**AUDIT RESULT: SYSTEM IS CORRECTLY CONFIGURED**

After comprehensive analysis, all enum/status values are correctly matched between database constraints and application code. The system properly distinguishes between invoice status values and schedule status values.

---

## Database Truth (CHECK Constraints)

### 1. accounts_payable.status
\`\`\`sql
CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue'))
\`\`\`
- Sources: `scripts/archive/03-create-purchase-tables.sql:48`, `scripts/archive/09-new-schema-with-integer-ids.sql:244`

### 2. accounts_receivable.status
\`\`\`sql
CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue'))
\`\`\`
- Sources: `scripts/archive/04-create-sales-tables.sql:58`, `scripts/archive/09-new-schema-with-integer-ids.sql:184`

### 3. payment_schedules.status
\`\`\`sql
CHECK (status IN ('pending', 'paid', 'overdue', 'partial'))
\`\`\`
- Source: `scripts/archive/041_create_payment_schedules_table.sql:10`
- **CRITICAL:** `'partial'` is ONLY valid here, NOT for invoice tables!

### 4. purchase_orders.status
\`\`\`sql
CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'received'))
\`\`\`

### 5. sales_orders.status
\`\`\`sql
CHECK (status IN ('draft', 'pending', 'pending_accountant', 'accountant_approved', 'ready_for_delivery', 'shipped', 'delivered', 'cancelled'))
\`\`\`

### 6. delivery_permits.status
\`\`\`sql
CHECK (status IN ('DRAFT', 'PRINTED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED'))
\`\`\`

### 7. balance_entries.status
\`\`\`sql
CHECK (status IN ('active', 'voided'))
\`\`\`

---

## Critical Distinction

| Target Table | "Partially Paid" Value | Where Used |
|--------------|------------------------|------------|
| `accounts_payable` | `"partially_paid"` | Invoice DB updates |
| `accounts_receivable` | `"partially_paid"` | Invoice DB updates |
| `payment_schedules` | `"partial"` | Schedule row updates |

---

## Code Verification

### Invoice Updates (Use "partially_paid")
| File | Line | Status | Correct? |
|------|------|--------|----------|
| `accounts-payable-module.tsx` | 439 | `"partially_paid"` | ✅ |
| `accounts-payable-module.tsx` | 524 | `"partially_paid"` | ✅ |
| `accounts-receivable-module.tsx` | 486 | `"partially_paid"` | ✅ |
| `accounts-receivable-module.tsx` | 511 | `"partially_paid"` | ✅ |
| `accounts-receivable-module.tsx` | 536 | `"partially_paid"` | ✅ |
| `accounts-receivable-module.tsx` | 611 | `"partially_paid"` | ✅ |
| `accountant-module.tsx` | 321 | `"partially_paid"` | ✅ |
| `approve-sales-orders-module.tsx` | 161 | `"partially_paid"` | ✅ |
| `payment-schedules/route.ts` | 389 | `"partially_paid"` | ✅ (AR invoice) |

### Schedule Updates (Use "partial")
| File | Line | Status | Correct? |
|------|------|--------|----------|
| `payment-schedules/route.ts` | 340 | `"partial"` | ✅ |
| `accounts-payable-module.tsx` | 306 | `"partial"` | ✅ (local schedule) |
| `accounts-payable-module.tsx` | 338 | `"partial"` | ✅ (local schedule) |

---

## Canonical Enum Module

Location: `lib/enums.ts`

The module exports:
- `AP_STATUS` - Accounts Payable invoice statuses
- `AR_STATUS` - Accounts Receivable invoice statuses  
- `SCHEDULE_STATUS` - Payment schedule statuses (includes "partial")
- `PO_STATUS` - Purchase Order statuses
- `SO_STATUS` - Sales Order statuses
- `DP_STATUS` - Delivery Permit statuses
- `BALANCE_STATUS` - Balance entry statuses
- `ENTITY_STATUS` - Customer/Supplier statuses
- `PAYMENT_TERMS` - Payment term options

Helper Functions:
- `computeInvoiceStatus()` - Returns `"partially_paid"` for invoices
- `computeScheduleStatus()` - Returns `"partial"` for schedules
- `isValidAPStatus()`, `isValidARStatus()`, `isValidScheduleStatus()` - Validators

---

## Type Definitions

### PaymentScheduleEntry (Local Interface)
\`\`\`typescript
// File: accounts-receivable-module.tsx:24
status: "pending" | "paid" | "overdue" | "partial"  // ✅ Correct for schedules
\`\`\`

### CustomerInvoice / SupplierInvoice (lib/types.ts)
\`\`\`typescript
status: "pending" | "partially_paid" | "paid" | "overdue"  // ✅ Correct for invoices
\`\`\`

---

## Conclusion

**NO CHANGES REQUIRED**

The system correctly implements the two-tier status model:
1. **Invoice status** (`partially_paid`): Used for AP/AR invoice table updates
2. **Schedule status** (`partial`): Used for payment_schedules table updates

All database writes use the correct values matching their respective CHECK constraints.

---

## Regression Testing

To verify the fix, test these scenarios:

1. **AP Payment Recording**
   - Record partial payment on AP invoice
   - Verify `accounts_payable.status` = `"partially_paid"`
   - Verify `payment_schedules.status` = `"partial"` for that entry

2. **AR Payment Recording**
   - Record partial payment on AR invoice
   - Verify `accounts_receivable.status` = `"partially_paid"`
   - Verify `payment_schedules.status` = `"partial"` for that entry

3. **Full Payment**
   - Complete full payment
   - Verify both tables show `status` = `"paid"`
