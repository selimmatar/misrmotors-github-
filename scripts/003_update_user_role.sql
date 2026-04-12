-- Query auth.users by email and update public.users by id
-- Update the role for selimmatar22@gmail.com to ceo
UPDATE public.users
SET role = 'ceo'
WHERE id = (
  SELECT id FROM auth.users WHERE email = 'selimmatar22@gmail.com'
);
