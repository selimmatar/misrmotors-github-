-- Create users table (extends auth.users with business roles)
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('ceo', 'sales', 'purchasing', 'accountant', 'inventory')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- RLS Policies for users
CREATE POLICY "Users can view their own data" ON public.users FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own data" ON public.users FOR UPDATE USING (auth.uid() = id);

-- Create customers table
CREATE TABLE IF NOT EXISTS public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all customers" ON public.customers FOR SELECT USING (true);
CREATE POLICY "Users can insert customers" ON public.customers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update customers" ON public.customers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete customers" ON public.customers FOR DELETE USING (auth.uid() = user_id);

-- Create suppliers table
CREATE TABLE IF NOT EXISTS public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all suppliers" ON public.suppliers FOR SELECT USING (true);
CREATE POLICY "Users can insert suppliers" ON public.suppliers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update suppliers" ON public.suppliers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete suppliers" ON public.suppliers FOR DELETE USING (auth.uid() = user_id);

-- Create products table
CREATE TABLE IF NOT EXISTS public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  price DECIMAL(10, 2) NOT NULL CHECK (price >= 0),
  moq INTEGER NOT NULL CHECK (moq > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Users can insert products" ON public.products FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update products" ON public.products FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete products" ON public.products FOR DELETE USING (auth.uid() = user_id);

-- Create inventory table
CREATE TABLE IF NOT EXISTS public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  reorder_point INTEGER NOT NULL CHECK (reorder_point >= 0),
  location TEXT NOT NULL,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  UNIQUE(product_id)
);

ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all inventory" ON public.inventory FOR SELECT USING (true);
CREATE POLICY "Users can insert inventory" ON public.inventory FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update inventory" ON public.inventory FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete inventory" ON public.inventory FOR DELETE USING (auth.uid() = user_id);

-- Create purchase_orders table
CREATE TABLE IF NOT EXISTS public.purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_number TEXT NOT NULL UNIQUE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  order_date TIMESTAMPTZ NOT NULL,
  delivery_date TIMESTAMPTZ NOT NULL,
  payment_terms TEXT NOT NULL,
  installments INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  notes TEXT,
  total DECIMAL(10, 2) NOT NULL CHECK (total >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all POs" ON public.purchase_orders FOR SELECT USING (true);
CREATE POLICY "Users can insert POs" ON public.purchase_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update POs" ON public.purchase_orders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete POs" ON public.purchase_orders FOR DELETE USING (auth.uid() = user_id);

-- Create purchase_order_items table
CREATE TABLE IF NOT EXISTS public.purchase_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0),
  total DECIMAL(10, 2) NOT NULL CHECK (total >= 0)
);

ALTER TABLE public.purchase_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all PO items" ON public.purchase_order_items FOR SELECT USING (true);
CREATE POLICY "Users can insert PO items" ON public.purchase_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update PO items" ON public.purchase_order_items FOR UPDATE USING (true);
CREATE POLICY "Users can delete PO items" ON public.purchase_order_items FOR DELETE USING (true);

-- Create sales_orders table
CREATE TABLE IF NOT EXISTS public.sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  order_date TIMESTAMPTZ NOT NULL,
  delivery_date TIMESTAMPTZ NOT NULL,
  payment_terms TEXT NOT NULL,
  installments INTEGER,
  status TEXT NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'rejected')),
  notes TEXT,
  total DECIMAL(10, 2) NOT NULL CHECK (total >= 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.sales_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all SOs" ON public.sales_orders FOR SELECT USING (true);
CREATE POLICY "Users can insert SOs" ON public.sales_orders FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update SOs" ON public.sales_orders FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete SOs" ON public.sales_orders FOR DELETE USING (auth.uid() = user_id);

-- Create sales_order_items table
CREATE TABLE IF NOT EXISTS public.sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price DECIMAL(10, 2) NOT NULL CHECK (unit_price >= 0),
  total DECIMAL(10, 2) NOT NULL CHECK (total >= 0)
);

ALTER TABLE public.sales_order_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all SO items" ON public.sales_order_items FOR SELECT USING (true);
CREATE POLICY "Users can insert SO items" ON public.sales_order_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update SO items" ON public.sales_order_items FOR UPDATE USING (true);
CREATE POLICY "Users can delete SO items" ON public.sales_order_items FOR DELETE USING (true);

-- Create supplier_invoices table (Accounts Payable)
CREATE TABLE IF NOT EXISTS public.supplier_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  po_id UUID NOT NULL REFERENCES public.purchase_orders(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  installment_months INTEGER,
  months_paid INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.supplier_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all supplier invoices" ON public.supplier_invoices FOR SELECT USING (true);
CREATE POLICY "Users can insert supplier invoices" ON public.supplier_invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update supplier invoices" ON public.supplier_invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete supplier invoices" ON public.supplier_invoices FOR DELETE USING (auth.uid() = user_id);

-- Create customer_invoices table (Accounts Receivable)
CREATE TABLE IF NOT EXISTS public.customer_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL UNIQUE,
  so_id UUID NOT NULL REFERENCES public.sales_orders(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL CHECK (amount >= 0),
  installment_months INTEGER,
  months_paid INTEGER DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE
);

ALTER TABLE public.customer_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all customer invoices" ON public.customer_invoices FOR SELECT USING (true);
CREATE POLICY "Users can insert customer invoices" ON public.customer_invoices FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update customer invoices" ON public.customer_invoices FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete customer invoices" ON public.customer_invoices FOR DELETE USING (auth.uid() = user_id);
