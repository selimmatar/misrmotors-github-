# Pre-Production Cleanup Checklist

## Debug Logs to Remove Before Go-Live

The following files contain `console.log("[v0]")` debug statements that should be removed:

### High Priority (User-Facing Modules)
- [ ] `components/modules/sales-order-module.tsx` - 9 statements
- [ ] `components/modules/accountant-module.tsx` - 8 statements
- [ ] `components/modules/financial-dashboard.tsx` - 5 statements
- [ ] `components/modules/lost-sales-module.tsx` - 3 statements
- [ ] `components/modules/supplier-module.tsx` - 1 statement
- [ ] `components/modules/analytics-dashboard.tsx` - 2 statements

### API Routes
- [ ] `app/api/sales-orders/route.ts` - 25 statements
- [ ] `app/api/purchase-orders/route.ts` - 14 statements
- [ ] `app/api/inventory/route.ts` - 9 statements
- [ ] `app/api/customers/route.ts` - 7 statements
- [ ] `app/api/suppliers/route.ts` - 7 statements
- [ ] `app/api/accounts-payable/route.ts` - 6 statements
- [ ] `app/api/delivery-permits/route.ts` - 15 statements
- [ ] `app/api/purchase-orders/pending-pricing/route.ts` - 6 statements
- [ ] `app/api/customer-payments/route.ts` - 5 statements
- [ ] `app/api/balance/route.ts` - 4 statements
- [ ] `app/api/payment-schedules/route.ts` - 3 statements
- [ ] `app/api/inventory/reorder-suggestions/route.ts` - 3 statements

### Components
- [ ] `components/report-generator.tsx` - 18 statements
- [ ] `components/payment/cheque-fields.tsx` - 3 statements
- [ ] `components/delivery-permit/delivery-permit-card.tsx` - 2 statements

### Test/Utility Files (Can Keep for Development)
- `lib/test-connection.ts` - removed 2026-10 (unused)

## Command to Find All Debug Logs
\`\`\`bash
grep -rn 'console.log("\[v0\]' --include="*.ts" --include="*.tsx" .
\`\`\`

## Automated Cleanup Script
Run this sed command to remove all v0 debug logs:
\`\`\`bash
find . -type f $$ -name "*.ts" -o -name "*.tsx" $$ -exec sed -i '' '/console\.log("\[v0\]/d' {} \;
\`\`\`

---

## Final QA Status Summary

### Fixed Issues (P0 - Critical)
1. ✅ AP payment update - Changed `invoiceId` to `id` in request body
2. ✅ PO creation - Added `po_number` to request body
3. ✅ PO approval - Changed `po_id` to `id` in request body

### Fixed Issues (P1 - High)
4. ✅ Down payment recalculation - Separated amount/percent update paths
5. ✅ Cheque fields not accepting input - Fixed field name mapping
6. ✅ Low stock filter - Added filtering for products in active POs

### Fixed Issues (P2 - Medium)
7. ✅ Schedule rounding - Added Math.round for currency precision
8. ✅ Progress bar not updating - Fixed by using loadData() refresh
9. ✅ Balance column error - Removed from API updates (auto-calculated)
10. ✅ JSON.JSON typo - Fixed to JSON.stringify

### Remaining Items for Production
- [ ] Remove all debug console.log statements
- [ ] Enable RLS policies on all tables
- [ ] Add API rate limiting
- [ ] Configure proper CORS headers
- [ ] Set up error monitoring (Sentry)
- [ ] Configure backup schedule
- [ ] Test all workflows end-to-end
- [ ] Load test with realistic data volume
