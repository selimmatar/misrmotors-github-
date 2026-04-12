-- Create admin user with credentials
-- Email: selimmatar@aucegypt.edu
-- Password: 123@321

-- Note: In Supabase, you need to manually create this user through the Supabase Dashboard
-- Go to Authentication > Users > Add user
-- Or use the "Login as Admin" button which will create the user automatically

-- Insert or update the role to admin for this specific user
INSERT INTO public.users (id, role, created_at)
SELECT id, 'admin', NOW()
FROM auth.users
WHERE email = 'selimmatar@aucegypt.edu'
ON CONFLICT (id) 
DO UPDATE SET role = 'admin';
