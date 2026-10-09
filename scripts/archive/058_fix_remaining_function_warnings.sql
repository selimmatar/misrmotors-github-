-- Fix remaining function search_path warnings
-- These are WARNING level issues that should be addressed for best security practices

-- 1. get_next_grn_number
ALTER FUNCTION public.get_next_grn_number() SET search_path = '';

-- 2. decrement_inventory
ALTER FUNCTION public.decrement_inventory(uuid, integer) SET search_path = '';

-- 3. increment_inventory
ALTER FUNCTION public.increment_inventory(uuid, integer) SET search_path = '';

-- 4. generate_qr_number
ALTER FUNCTION public.generate_qr_number() SET search_path = '';

-- 5. update_overdue_schedules
ALTER FUNCTION public.update_overdue_schedules() SET search_path = '';

-- 6. generate_quotation_number
ALTER FUNCTION public.generate_quotation_number() SET search_path = '';

-- 7. generate_po_request_number
ALTER FUNCTION public.generate_po_request_number() SET search_path = '';

-- 8. convert_quotation_to_sales_order
ALTER FUNCTION public.convert_quotation_to_sales_order(uuid) SET search_path = '';

-- 9. save_quotation_revision
ALTER FUNCTION public.save_quotation_revision(uuid, jsonb, numeric, text, text) SET search_path = '';

-- 10. generate_employee_number
ALTER FUNCTION public.generate_employee_number() SET search_path = '';

-- 11. generate_transfer_number
ALTER FUNCTION public.generate_transfer_number() SET search_path = '';
