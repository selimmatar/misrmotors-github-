-- Fix all security vulnerabilities in database
-- This script:
-- 1. Drops all report views with SECURITY DEFINER
-- 2. Adds RLS policy for workflow_events
-- 3. Fixes function search_path issues

-- ============================================
-- 1. DROP ALL REPORT VIEWS (SECURITY DEFINER)
-- ============================================

DROP VIEW IF EXISTS public.report_product_performance CASCADE;
DROP VIEW IF EXISTS public.report_cash_flow CASCADE;
DROP VIEW IF EXISTS public.report_purchase_by_supplier CASCADE;
DROP VIEW IF EXISTS public.report_ar_summary CASCADE;
DROP VIEW IF EXISTS public.report_sales_summary CASCADE;
DROP VIEW IF EXISTS public.report_lost_sales_summary CASCADE;
DROP VIEW IF EXISTS public.report_inventory_valuation CASCADE;
DROP VIEW IF EXISTS public.report_ar_aging CASCADE;
DROP VIEW IF EXISTS public.report_inventory_by_category CASCADE;
DROP VIEW IF EXISTS public.report_top_lost_items CASCADE;
DROP VIEW IF EXISTS public.report_purchase_summary CASCADE;
DROP VIEW IF EXISTS public.report_ap_aging CASCADE;
DROP VIEW IF EXISTS public.report_purchase_details CASCADE;
DROP VIEW IF EXISTS public.report_sales_by_customer CASCADE;
DROP VIEW IF EXISTS public.report_sales_details CASCADE;
DROP VIEW IF EXISTS public.report_lost_sales CASCADE;
DROP VIEW IF EXISTS public.report_financial_summary CASCADE;
DROP VIEW IF EXISTS public.report_top_products CASCADE;
DROP VIEW IF EXISTS public.report_ap_summary CASCADE;

-- ============================================
-- 2. ADD RLS POLICY FOR workflow_events
-- ============================================

-- Allow all authenticated users to read workflow events
CREATE POLICY "Allow authenticated users to read workflow events"
ON public.workflow_events
FOR SELECT
TO authenticated
USING (true);

-- ============================================
-- 3. FIX FUNCTION SEARCH PATHS
-- ============================================

-- Fix update_updated_at_column
ALTER FUNCTION public.update_updated_at_column()
SET search_path = '';

-- Fix update_inventory_last_updated
ALTER FUNCTION public.update_inventory_last_updated()
SET search_path = '';

-- Fix update_payment_schedule_timestamp
ALTER FUNCTION public.update_payment_schedule_timestamp()
SET search_path = '';

-- Fix generate_grn_number
ALTER FUNCTION public.generate_grn_number()
SET search_path = '';

-- Fix set_grn_number
ALTER FUNCTION public.set_grn_number()
SET search_path = '';
