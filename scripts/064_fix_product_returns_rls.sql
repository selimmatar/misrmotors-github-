-- Fix RLS policy for product_returns table
-- Drop existing policy and recreate it properly

DROP POLICY IF EXISTS "Allow authenticated users full access to product_returns" ON product_returns;

-- Create a policy that allows all operations for authenticated users
CREATE POLICY "Enable all access for authenticated users"
ON product_returns
FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Also create a policy for service role to ensure backend operations work
CREATE POLICY "Enable all access for service role"
ON product_returns
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
