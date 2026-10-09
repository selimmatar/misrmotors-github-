-- Add admin role to the users table role enum
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('ceo', 'sales', 'purchasing', 'accountant', 'inventory', 'admin'));

-- Create RLS policy for admin to manage all users
CREATE POLICY "Admins can view all users" ON public.users 
  FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
    OR auth.uid() = id
  );

CREATE POLICY "Admins can update all users" ON public.users 
  FOR UPDATE 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

CREATE POLICY "Admins can delete users" ON public.users 
  FOR DELETE 
  USING (
    EXISTS (
      SELECT 1 FROM public.users 
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
