-- Fix search_path for existing functions to resolve security warnings
-- This sets an empty search_path which forces schema-qualified references

-- Fix calculate_quotation_totals
ALTER FUNCTION calculate_quotation_totals(integer) SET search_path = '';

-- Fix calculate_sales_order_totals  
ALTER FUNCTION calculate_sales_order_totals(integer) SET search_path = '';

-- Note: The other 9 functions mentioned in the security warnings don't exist in the database
-- so they can't be fixed. They may have been dropped already.
