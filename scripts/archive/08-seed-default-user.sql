-- Insert a default admin user
-- Password is 'admin123' (you should change this after first login)
INSERT INTO users (email, password_hash, full_name, role, is_active)
VALUES 
  ('admin@waterpumps.com', '$2a$10$8K1p/a0dL3LHfh3L8KhU/OuI7hzCjjD3QJ5bFqnSn0EYBhxYxxYJK', 'Admin User', 'admin', true),
  ('ceo@waterpumps.com', '$2a$10$8K1p/a0dL3LHfh3L8KhU/OuI7hzCjjD3QJ5bFqnSn0EYBhxYxxYJK', 'CEO User', 'ceo', true),
  ('accountant@waterpumps.com', '$2a$10$8K1p/a0dL3LHfh3L8KhU/OuI7hzCjjD3QJ5bFqnSn0EYBhxYxxYJK', 'Accountant User', 'accountant', true)
ON CONFLICT (email) DO NOTHING;
