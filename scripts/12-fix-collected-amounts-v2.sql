-- Fix collected_amount for existing invoices with monthsPaid > 0 but collected_amount = 0

UPDATE customer_invoices 
SET collected_amount = ROUND(amount::numeric / installment_months * months_paid, 2)
WHERE collected_amount = 0 
  AND months_paid > 0 
  AND installment_months > 0;

-- Verify the updates
SELECT invoice_id, invoice_number, amount, collected_amount, months_paid, installment_months, status
FROM customer_invoices
WHERE invoice_id IN (6, 7, 8);
