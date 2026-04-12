# AP Hybrid Payment Misclassification - Root Cause & Fix

## Root Cause Identified

**The Bug**: AP invoices with `payment_type="hybrid"` were being treated as `"installments"` in the payment schedule generation and pay screen.

### Why It Happened:

1. **Database Schema Mismatch**:
   - `purchase_orders` table has `payment_type` column (supports: cash, installments, cheque, hybrid, prepaid)
   - `accounts_payable` table had ONLY `payment_terms` column (legacy field, only supports: installment, prepaid)
   - **NO `payment_type` column existed in `accounts_payable`** → hybrid payment info was lost!

2. **API Mapping Bug** (`app/api/accounts-payable/route.ts` line 60):
   \`\`\`typescript
   paymentTerms: inv.payment_terms || inv.purchase_orders?.payment_terms || "installment"
   \`\`\`
   - API returned `paymentTerms` (legacy field) instead of `payment_type`
   - Default fallback was `"installment"` → **hybrid became installment**!

3. **Frontend Logic** (`components/modules/accounts-payable-module.tsx` line 206):
   \`\`\`typescript
   const paymentType = po?.paymentType || po?.paymentTerms || invoice.paymentTerms || "cash"
   \`\`\`
   - Frontend read from `invoice.paymentTerms` which was "installment"
   - PO's `paymentType="hybrid"` was ignored because invoice had wrong value

## Fix Applied

### 1. Database Migration (`scripts/058_add_payment_type_to_ap.sql`)

**Added**:
- `payment_type` column to `accounts_payable`
- `down_payment_amount`, `remaining_amount`, `remaining_installment_months`, `monthly_amount`, `payment_start_date` columns

**Migrated**:
- Copied `payment_type` from linked `purchase_orders` for all existing AP invoices
- Synced hybrid payment details (down payment amounts, remaining balances, etc.)

### 2. API Route Fix (`app/api/accounts-payable/route.ts`)

**GET Handler**:
- Now selects `payment_type` and all hybrid fields from PO join
- Returns `paymentType` field in response (not just `paymentTerms`)
- Returns all hybrid-specific fields: `downPaymentAmount`, `remainingAmount`, `monthlyAmount`, etc.

**POST Handler**:
- Now accepts and saves `payment_type` field
- Saves all hybrid payment details to AP invoice

### 3. Frontend Fix (`components/modules/accounts-payable-module.tsx`)

**Schedule Generation**:
- Now reads `invoice.paymentType` FIRST (from database), then falls back to PO
- Hybrid logic uses `invoice.downPaymentAmount`, `invoice.remainingAmount`, etc. from database
- Added debug logging: `console.log("[v0] AP generateSchedule - Payment Type:", paymentType)`

**TypeScript Types** (`lib/types.ts`):
- Added `paymentType`, `downPaymentAmount`, `remainingAmount`, etc. to `AccountsPayableInvoice` interface

## How It Works Now

### Creating AP Invoice with Hybrid Payment:

1. **PO Approved** → Creates AP invoice via PO module
2. **PO Module** sends `payment_type="hybrid"` + all hybrid fields to AP API
3. **AP API POST** saves `payment_type="hybrid"` to `accounts_payable` table
4. **AP API GET** returns invoice with `paymentType="hybrid"` + hybrid details
5. **AP Module** reads `invoice.paymentType="hybrid"` → generates correct schedule:
   - Downpayment entry (installment #0, `isDownPayment: true`)
   - Monthly installment entries for remaining balance

### Payment Flow:

1. **View Schedule** → `fetchPaymentSchedule(invoice)` 
   - Reads `paymentType` from invoice (now "hybrid")
   - Calls `generateScheduleFromInvoice(invoice)` with correct type
   - Shows downpayment row + installment rows

2. **Record Payment** → Marks schedule entry as paid
   - Updates invoice `paidAmount`, `monthsPaid`, `status`
   - Progress bar reflects correct total (downpayment + installments)

## Verification Steps

### Test Case 1: Create New Hybrid AP Invoice

1. Create PO with `payment_type="hybrid"`, downpayment 30%, 6 month installments
2. Approve PO → AP invoice created
3. Go to AP module → Click "View Schedule"
4. **Expected**: See 7 rows (1 downpayment + 6 installments)
5. **Console log**: `[v0] AP generateSchedule - Payment Type: hybrid`

### Test Case 2: Pay Hybrid Invoice

1. Open schedule for hybrid invoice
2. Record payment on downpayment row
3. **Expected**: Downpayment marked as paid, progress bar moves correctly
4. Record payment on month 1
5. **Expected**: Month 1 marked as paid, progress bar continues correctly

### Test Case 3: Verify Installment Still Works

1. Create PO with `payment_type="installments"`, 12 months
2. Approve PO → AP invoice created
3. Go to AP module → Click "View Schedule"
4. **Expected**: See 12 rows (NO downpayment), all equal amounts
5. **Console log**: `[v0] AP generateSchedule - Payment Type: installments`

## Migration Impact

**Existing Data**:
- All existing AP invoices now have `payment_type` synced from their POs
- Hybrid invoices now have downpayment details stored in AP table
- NO workflow changes required - fix is transparent

**Safety**: Migration script is idempotent - safe to run multiple times.
