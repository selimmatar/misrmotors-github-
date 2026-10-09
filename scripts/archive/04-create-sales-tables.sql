-- Create Sales Orders table
CREATE TABLE sales_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_number TEXT UNIQUE NOT NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  order_date DATE NOT NULL,
  delivery_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',
    'pending',
    'pending_accountant',
    'accountant_approved',
    'ready_for_delivery',
    'shipped',
    'delivered',
    'cancelled'
  )),
  payment_terms TEXT NOT NULL CHECK (payment_terms IN ('prepaid', 'installment')),
  installments INTEGER,
  total NUMERIC(12, 2) NOT NULL,
  notes TEXT,
  invoice_file_url TEXT,
  shipping_invoice_url TEXT,
  created_by UUID REFERENCES users(id),
  approved_by UUID REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  shipped_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create Sales Order Items table
CREATE TABLE sales_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  so_id UUID NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price NUMERIC(12, 2) NOT NULL,
  total NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create Customer Invoices table (Accounts Receivable)
CREATE TABLE customer_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT UNIQUE NOT NULL,
  so_id UUID REFERENCES sales_orders(id) ON DELETE SET NULL,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  due_date DATE NOT NULL,
  amount NUMERIC(12, 2) NOT NULL,
  collected_amount NUMERIC(12, 2) DEFAULT 0,
  balance NUMERIC(12, 2) NOT NULL,
  payment_terms TEXT NOT NULL CHECK (payment_terms IN ('prepaid', 'installment')),
  installment_months INTEGER DEFAULT 1,
  months_paid INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'partially_paid', 'paid', 'overdue')),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create Customer Payments table
CREATE TABLE customer_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES customer_invoices(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  amount NUMERIC(12, 2) NOT NULL,
  payment_date DATE NOT NULL,
  payment_method TEXT NOT NULL,
  reference_number TEXT,
  recorded_by UUID REFERENCES users(id),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes
CREATE INDEX idx_so_customer ON sales_orders(customer_id);
CREATE INDEX idx_so_status ON sales_orders(status);
CREATE INDEX idx_so_number ON sales_orders(so_number);
CREATE INDEX idx_so_items_so ON sales_order_items(so_id);
CREATE INDEX idx_so_items_product ON sales_order_items(product_id);
CREATE INDEX idx_customer_invoices_customer ON customer_invoices(customer_id);
CREATE INDEX idx_customer_invoices_so ON customer_invoices(so_id);
CREATE INDEX idx_customer_invoices_status ON customer_invoices(status);
CREATE INDEX idx_customer_payments_invoice ON customer_payments(invoice_id);
