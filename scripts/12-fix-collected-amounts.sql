-- Fix collected_amount for existing invoices that have monthsPaid > 0 but collected_amount = 0

-- Update Invoice #8 (Customer 5, SO-2025-008): 3 installments, 1 month paid
-- Monthly amount: 30000 / 3 = 10000
UPDATE customer_invoices 
SET collected_amount = 10000
WHERE invoice_id = 8 AND collected_amount = 0 AND months_paid = 1;

-- Update Invoice #7 (Customer 5, SO-2025-007): 3 installments, 1 month paid
-- Monthly amount: 14000 / 3 = 4666.67
UPDATE customer_invoices 
SET collected_amount = ROUND(14000.0 / 3, 2)
WHERE invoice_id = 7 AND collected_amount = 0 AND months_paid = 1;

-- Update Invoice #6 (Customer 1, SO-2025-001): 3 installments, 1 month paid
-- Monthly amount: 14000 / 3 = 4666.67
UPDATE customer_invoices 
SET collected_amount = ROUND(14000.0 / 3, 2)
WHERE invoice_id = 6 AND collected_amount = 0 AND months_paid = 1;

-- Check the results
SELECT invoice_id, invoice_number, amount, collected_amount, months_paid, installment_months, status
FROM customer_invoices
WHERE invoice_id IN (6, 7, 8);
