-- Add payment_start_date column to sales_orders and purchase_orders
-- This allows specifying when installment payments will begin

ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS payment_start_date DATE;

ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS payment_start_date DATE;

-- Add payment_start_date to accounts_receivable and accounts_payable
ALTER TABLE accounts_receivable 
ADD COLUMN IF NOT EXISTS payment_start_date DATE;

ALTER TABLE accounts_payable 
ADD COLUMN IF NOT EXISTS payment_start_date DATE;
