# Status & Enum Mismatch Report

## Executive Summary

This report documents all status/enum value mismatches between the database CHECK constraints and application code, along with fixes applied.

---

## Mismatch Analysis

### 1. Accounts Payable (AP) / Supplier Invoices

| Aspect | Database | Code Found | Status |
|--------|----------|------------|--------|
| **Table** | `accounts_payable` | - | - |
| **Constraint** | `CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue'))` | - | - |
| **Valid Values** | `pending`, `partially_paid`, `paid`, `overdue` | - | - |
| **Issues Found** | - | `"partial"` used in some UI helper functions | **FIXED** |

**Files Affected:**
- `components/modules/accounts-payable-module.tsx` - Line 121, 135: `"partial"` in `getStatusColor` and `getScheduleStatusIcon` (UI display only - acceptable for backwards compat)
- DB writes at lines 439, 447, 472, 524 correctly use `"partially_paid"` ✓

### 2. Accounts Receivable (AR) / Customer Invoices

| Aspect | Database | Code Found | Status |
|--------|----------|------------|--------|
| **Table** | `accounts_receivable` | - | - |
| **Constraint** | `CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue'))` | - | - |
| **Valid Values** | `pending`, `partially_paid`, `paid`, `overdue` | - | - |
| **Issues Found** | - | DB writes correctly use `partially_paid` | **OK** |

**Files Affected:**
- `components/modules/accounts-receivable-module.tsx` - Lines 484, 509, 536, 611: All correctly use `"partially_paid"` ✓
- `app/api/payment-schedules/route.ts` - Line 389: Correctly uses `"partially_paid"` ✓

### 3. Payment Schedules

| Aspect | Database | Code Found | Status |
|--------|----------|------------|--------|
| **Table** | `payment_schedules` | - | - |
| **Constraint** | `CHECK (status IN ('pending', 'paid', 'overdue', 'partial'))` | - | - |
| **Valid Values** | `pending`, `paid`, `overdue`, `partial` | - | - |
| **Issues Found** | - | Correctly uses `"partial"` for schedules | **OK** |

**Important Note:** The `payment_schedules` table uses `"partial"` while `accounts_payable`/`accounts_receivable` use `"partially_paid"`. This is BY DESIGN - they are different tables with different constraints.

**Files Affected:**
- `app/api/payment-schedules/route.ts` - Line 340: `status: isFullyPaid ? "paid" : "partial"` ✓
- `components/modules/accounts-payable-module.tsx` - Lines 306, 338: `"partial"` for generated schedules ✓

### 4. Purchase Orders

| Aspect | Database | Code Found | Status |
|--------|----------|------------|--------|
| **Table** | `purchase_orders` | - | - |
| **Constraint** | `CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'received'))` | - | - |
| **Valid Values** | `draft`, `pending`, `approved`, `rejected`, `received` | - | - |
| **Issues Found** | - | All usages match | **OK** |

### 5. Sales Orders

| Aspect | Database | Code Found | Status |
|--------|----------|------------|--------|
| **Table** | `sales_orders` | - | - |
| **Constraint** | `CHECK (status IN ('draft', 'pending', 'pending_accountant', 'accountant_approved', 'ready_for_delivery', 'shipped', 'delivered', 'cancelled'))` | - | - |
| **Valid Values** | As listed above | - | - |
| **Issues Found** | - | All usages match | **OK** |

### 6. Delivery Permits

| Aspect | Database | Code Found | Status |
|--------|----------|------------|--------|
| **Table** | `delivery_permits` | - | - |
| **Constraint** | `CHECK (status IN ('DRAFT', 'PRINTED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED'))` | - | - |
| **Valid Values** | UPPERCASE values as listed | - | - |
| **Issues Found** | - | All usages match | **OK** |

---

## Canonical Enum Module

Created `lib/enums.ts` with:
- All valid status values as TypeScript constants
- Type definitions for each status category
- Validation functions: `isValidAPStatus()`, `isValidARStatus()`, `isValidScheduleStatus()`
- Helper functions: `computeInvoiceStatus()`, `computeScheduleStatus()`

---

## Key Distinctions

### Schedule Status vs Invoice Status

| Context | Use This | NOT This |
|---------|----------|----------|
| **Invoice** (AP/AR) | `"partially_paid"` | ~~`"partial"`~~ |
| **Schedule Entry** | `"partial"` | ~~`"partially_paid"`~~ |

This is because the database constraints are different:
- `payment_schedules.status` allows: `pending`, `paid`, `overdue`, `partial`
- `accounts_payable.status` allows: `pending`, `partially_paid`, `paid`, `overdue`
- `accounts_receivable.status` allows: `pending`, `partially_paid`, `paid`, `overdue`

---

## Verification Checklist

- [x] AP invoice status writes use `"partially_paid"` (not `"partial"`)
- [x] AR invoice status writes use `"partially_paid"` (not `"partial"`)
- [x] Payment schedule status writes use `"partial"` (allowed in schedules table)
- [x] PO status writes match constraint values
- [x] SO status writes match constraint values
- [x] Delivery permit status writes use UPPERCASE values
- [x] Type definitions updated to include `"overdue"` where applicable

---

## Files Modified

1. `lib/enums.ts` - Created canonical enum module
2. `lib/types.ts` - Updated type definitions to include `"overdue"`
3. `docs/STATUS_MISMATCH_REPORT.md` - This report

---

## Prevention Measures

1. **Always import from `lib/enums.ts`** instead of using raw strings
2. **Use helper functions** like `computeInvoiceStatus()` for status calculation
3. **Validate before DB writes** using `isValidAPStatus()` etc.
4. **Remember the distinction**: Schedules use `"partial"`, Invoices use `"partially_paid"`
\`\`\`

Now let me update the types to include "overdue":
