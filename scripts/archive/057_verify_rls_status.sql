-- =====================================================================
-- RLS STATUS VERIFICATION SCRIPT
-- =====================================================================
-- Run this to verify RLS activation and see which tables have policies

-- Table 1: Show RLS enabled/disabled status for all public tables
SELECT 
  tablename,
  CASE WHEN rowsecurity THEN '✓ ENABLED' ELSE '✗ DISABLED' END as rls_status
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;

-- Table 2: Count policies per table
SELECT 
  tablename,
  COUNT(*) as policy_count,
  STRING_AGG(policyname, ', ' ORDER BY policyname) as policies
FROM pg_policies 
WHERE schemaname = 'public' 
GROUP BY tablename
ORDER BY tablename;

-- Table 3: Summary statistics
SELECT 
  COUNT(DISTINCT t.tablename) as total_tables,
  SUM(CASE WHEN t.rowsecurity THEN 1 ELSE 0 END) as tables_with_rls_enabled,
  COUNT(p.policyname) as total_policies
FROM pg_tables t
LEFT JOIN pg_policies p ON p.tablename = t.tablename AND p.schemaname = t.schemaname
WHERE t.schemaname = 'public';
