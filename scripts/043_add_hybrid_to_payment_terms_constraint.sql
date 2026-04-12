-- Add 'hybrid' to the allowed payment_terms values in purchase_orders table

-- First, drop the existing constraint
ALTER TABLE purchase_orders 
DROP CONSTRAINT IF EXISTS purchase_orders_payment_terms_check;

-- Add the new constraint with 'hybrid' included
ALTER TABLE purchase_orders 
ADD CONSTRAINT purchase_orders_payment_terms_check 
CHECK (payment_terms IN ('prepaid', 'installment', 'cash', 'cheque', 'hybrid'));
