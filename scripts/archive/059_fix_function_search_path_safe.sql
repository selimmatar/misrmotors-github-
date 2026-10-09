-- Fix function search_path warnings for all existing functions
-- This script uses a safe approach that doesn't require exact function signatures

-- Fix decrement_inventory function
DO $$
DECLARE
    func_oid oid;
BEGIN
    SELECT oid INTO func_oid FROM pg_proc WHERE proname = 'decrement_inventory' AND pronamespace = 'public'::regnamespace LIMIT 1;
    IF func_oid IS NOT NULL THEN
        EXECUTE 'ALTER FUNCTION public.decrement_inventory(p_product_id integer, p_warehouse_id integer, p_quantity integer) SET search_path = ''''';
        RAISE NOTICE 'Fixed search_path for decrement_inventory';
    END IF;
END $$;

-- Fix increment_inventory function
DO $$
DECLARE
    func_oid oid;
BEGIN
    SELECT oid INTO func_oid FROM pg_proc WHERE proname = 'increment_inventory' AND pronamespace = 'public'::regnamespace LIMIT 1;
    IF func_oid IS NOT NULL THEN
        EXECUTE 'ALTER FUNCTION public.increment_inventory(p_product_id integer, p_warehouse_id integer, p_quantity integer) SET search_path = ''''';
        RAISE NOTICE 'Fixed search_path for increment_inventory';
    END IF;
END $$;

-- Comprehensive fix for any remaining functions in public schema
-- This will set search_path for all public functions to make them secure
DO $$
DECLARE
    func_record RECORD;
    func_signature TEXT;
BEGIN
    FOR func_record IN 
        SELECT 
            p.oid,
            p.proname as function_name,
            pg_get_function_identity_arguments(p.oid) as arguments
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public'
          AND p.prosecdef = false  -- Not security definer functions
          AND NOT EXISTS (
              SELECT 1 FROM pg_proc_config pc WHERE pc.oid = p.oid AND pc.setconfig::text LIKE '%search_path%'
          )
    LOOP
        BEGIN
            func_signature := func_record.function_name || '(' || func_record.arguments || ')';
            EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = ''''', func_record.function_name, func_record.arguments);
            RAISE NOTICE 'Fixed search_path for function: %', func_signature;
        EXCEPTION
            WHEN OTHERS THEN
                RAISE WARNING 'Could not fix function %: %', func_signature, SQLERRM;
        END;
    END LOOP;
END $$;
