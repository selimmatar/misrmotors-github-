-- Add new statuses to sales_orders for warehouse approval workflow
-- This migration adds 'pending_warehouse' and 'out_for_delivery' statuses

-- Drop the existing check constraint
ALTER TABLE public.sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;

-- Add new check constraint with additional statuses
ALTER TABLE public.sales_orders 
ADD CONSTRAINT sales_orders_status_check 
CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'pending_warehouse', 'out_for_delivery', 'delivered'));
