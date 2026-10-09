-- Detect and report potentially corrupted AP payment schedules
-- This script ONLY reports issues, does not modify data

-- Find payment schedules with suspicious 0 amounts
SELECT 
    ps.schedule_id,
    ps.invoice_id,
    ps.po_id,
    ps.installment_number,
    ps.amount,
    ps.paid_amount,
    ps.status,
    ps.is_down_payment,
    ap.payment_type,
    ap.amount as invoice_total,
    po.po_number
FROM payment_schedules ps
LEFT JOIN accounts_payable ap ON ps.invoice_id = ap.invoice_id
LEFT JOIN purchase_orders po ON ps.po_id = po.po_id
WHERE ps.schedule_type = 'payable'
  AND ps.amount = 0
ORDER BY ps.created_at DESC;

-- Find hybrid AP invoices with missing schedule details
SELECT 
    ap.invoice_id,
    ap.invoice_number,
    ap.payment_type,
    ap.amount as total_amount,
    ap.down_payment_amount,
    ap.remaining_amount,
    ap.remaining_installment_months,
    ap.monthly_amount,
    po.po_number,
    po.po_type,
    COUNT(ps.schedule_id) as schedule_count
FROM accounts_payable ap
LEFT JOIN purchase_orders po ON ap.po_id = po.po_id
LEFT JOIN payment_schedules ps ON ap.invoice_id = ps.invoice_id
WHERE ap.payment_type = 'hybrid'
  AND (ap.down_payment_amount IS NULL OR ap.down_payment_amount = 0)
  AND (ap.remaining_amount IS NULL OR ap.remaining_amount = 0)
GROUP BY ap.invoice_id, ap.invoice_number, ap.payment_type, ap.amount, 
         ap.down_payment_amount, ap.remaining_amount, ap.remaining_installment_months,
         ap.monthly_amount, po.po_number, po.po_type
ORDER BY ap.created_at DESC;

-- Find schedules auto-marked as paid that shouldn't be
SELECT 
    ps.schedule_id,
    ps.invoice_id,
    ps.installment_number,
    ps.amount,
    ps.paid_amount,
    ps.status,
    ps.payment_date,
    ps.is_down_payment,
    ps.created_at
FROM payment_schedules ps
WHERE ps.schedule_type = 'payable'
  AND ps.status = 'paid'
  AND (ps.paid_amount = 0 OR ps.paid_amount IS NULL)
  AND ps.payment_date IS NULL
ORDER BY ps.created_at DESC;

-- Summary report
SELECT 
    'Zero Amount Schedules' as issue_type,
    COUNT(*) as count
FROM payment_schedules
WHERE schedule_type = 'payable' AND amount = 0
UNION ALL
SELECT 
    'Hybrid with Missing Amounts' as issue_type,
    COUNT(*)
FROM accounts_payable
WHERE payment_type = 'hybrid'
  AND (down_payment_amount IS NULL OR down_payment_amount = 0)
  AND (remaining_amount IS NULL OR remaining_amount = 0)
UNION ALL
SELECT 
    'Auto-marked Paid Incorrectly' as issue_type,
    COUNT(*)
FROM payment_schedules
WHERE schedule_type = 'payable'
  AND status = 'paid'
  AND (paid_amount = 0 OR paid_amount IS NULL)
  AND payment_date IS NULL;
