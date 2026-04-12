-- Script to clean up duplicate invoices and fix incorrect collected amounts

-- Find and display all duplicate invoices (multiple invoices for the same SO)
SELECT 
  ar.invoice_id,
  ar.invoice_number,
  ar.so_id,
  so.so_number,
  ar.amount,
  ar.collected_amount,
  ar.created_at
FROM accounts_receivable ar
JOIN sales_orders so ON ar.so_id = so.so_id
WHERE ar.so_id IN (
  SELECT so_id 
  FROM accounts_receivable 
  GROUP BY so_id 
  HAVING COUNT(*) > 1
)
ORDER BY ar.so_id, ar.created_at;

-- Delete duplicate invoices (keep the first one created, delete the rest)
-- This will keep INV-2026-* format and delete INV-CUST-* format
DELETE FROM accounts_receivable
WHERE invoice_id IN (
  SELECT ar2.invoice_id
  FROM accounts_receivable ar1
  JOIN accounts_receivable ar2 ON ar1.so_id = ar2.so_id AND ar1.invoice_id < ar2.invoice_id
  WHERE ar1.so_id IN (
    SELECT so_id 
    FROM accounts_receivable 
    GROUP BY so_id 
    HAVING COUNT(*) > 1
  )
);

-- Fix any invoices that have incorrect collected_amount (should be 0 initially)
-- Only fix if there are no actual customer payments recorded
UPDATE accounts_receivable
SET collected_amount = 0,
    status = 'pending'
WHERE collected_amount > 0
  AND invoice_id NOT IN (
    SELECT DISTINCT invoice_id 
    FROM customer_payments 
    WHERE invoice_id IS NOT NULL
  );

-- Verify results
SELECT 
  'After cleanup' as status,
  COUNT(DISTINCT so_id) as unique_sos,
  COUNT(*) as total_invoices,
  COUNT(*) - COUNT(DISTINCT so_id) as duplicates
FROM accounts_receivable;
