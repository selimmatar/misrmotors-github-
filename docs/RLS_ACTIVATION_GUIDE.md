# Row Level Security (RLS) Activation Guide

## Overview
This guide explains how to activate RLS for production deployment of your ERP system.

## Current Security Model
Your ERP uses **SERVICE ROLE KEY** for all database operations, which means:
- All API routes bypass RLS automatically
- RLS acts as a **safety net** if the anon key is accidentally used
- Data is protected even if there's a misconfiguration

## Activation Steps

### 1. Run the RLS Activation Script
Execute `scripts/055_activate_rls_production.sql` in your Supabase SQL Editor:

\`\`\`bash
# From Supabase Dashboard:
1. Go to SQL Editor
2. Click "New Query"
3. Copy and paste the contents of scripts/055_activate_rls_production.sql
4. Click "Run"
\`\`\`

### 2. Verify RLS is Enabled
Run this query to confirm:

\`\`\`sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE schemaname = 'public' 
ORDER BY tablename;
\`\`\`

All tables should show `rowsecurity = true`.

### 3. Verify Policies Exist
Run this query:

\`\`\`sql
SELECT schemaname, tablename, policyname, roles 
FROM pg_policies 
WHERE schemaname = 'public' 
ORDER BY tablename, policyname;
\`\`\`

You should see 2 policies per table (authenticated + service_role).

## Security Architecture

### Policy Structure
Each table has TWO policies:

1. **authenticated_[table]_all**
   - Allows full access to authenticated users
   - Prevents anon key access

2. **service_role_[table]_all**
   - Allows service role to bypass RLS
   - Used by API routes

### Why This Works
- API routes use `SUPABASE_SERVICE_ROLE_KEY` → bypass RLS ✅
- Accidental anon key usage → blocked by RLS ✅
- Direct database access without auth → blocked ✅

## Testing RLS

### Test 1: Verify Service Role Bypasses RLS
\`\`\`javascript
// This should work (uses service role)
const { data } = await supabaseAdmin
  .from('sales_orders')
  .select('*');
\`\`\`

### Test 2: Verify Anon Key is Blocked
\`\`\`javascript
// This should fail (anon key + no auth)
const { data, error } = await supabaseClient
  .from('sales_orders')
  .select('*');
// error: "new row violates row-level security policy"
\`\`\`

### Test 3: Verify Authenticated Access Works
\`\`\`javascript
// This should work (authenticated user)
const { data } = await supabaseClient
  .auth.signInWithPassword({email, password});
const { data: orders } = await supabaseClient
  .from('sales_orders')
  .select('*');
\`\`\`

## Rollback (If Needed)

If you need to disable RLS temporarily:

\`\`\`sql
-- Disable RLS on specific table
ALTER TABLE sales_orders DISABLE ROW LEVEL SECURITY;

-- Or disable on all tables
DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')
    LOOP
        EXECUTE 'ALTER TABLE ' || r.tablename || ' DISABLE ROW LEVEL SECURITY';
    END LOOP;
END $$;
\`\`\`

## Production Checklist

- [ ] Run RLS activation script
- [ ] Verify all tables have RLS enabled
- [ ] Verify policies exist for all tables
- [ ] Test API routes still work (should bypass RLS)
- [ ] Test direct Supabase client access requires auth
- [ ] Document service role key location (secure)
- [ ] Ensure anon key is NOT in production env vars
- [ ] Monitor logs for RLS policy violations

## Advanced: Role-Based Policies

For future enhancement, you can create role-based policies:

\`\`\`sql
-- Example: Only CEOs can delete sales orders
CREATE POLICY "ceo_can_delete_sales_orders" ON sales_orders
  FOR DELETE
  TO authenticated
  USING (
    (current_setting('request.jwt.claims', true)::json->>'role') = 'ceo'
  );
\`\`\`

But for now, the simple "all authenticated users" policy is secure and functional.
