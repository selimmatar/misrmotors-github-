-- Sales Quotations Table
CREATE TABLE IF NOT EXISTS sales_quotations (
  id SERIAL PRIMARY KEY,
  quotation_number VARCHAR(50) UNIQUE NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  customer_phone VARCHAR(50),
  customer_email VARCHAR(255),
  validity_days INTEGER DEFAULT 30,
  notes TEXT,
  subtotal DECIMAL(15, 2) NOT NULL DEFAULT 0,
  tax DECIMAL(15, 2) NOT NULL DEFAULT 0,
  total DECIMAL(15, 2) NOT NULL DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_quotations_number ON sales_quotations(quotation_number);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_customer ON sales_quotations(customer_name);
CREATE INDEX IF NOT EXISTS idx_sales_quotations_created ON sales_quotations(created_at DESC);

-- Sales Quotation Items (without foreign key to products to avoid dependency issues)
CREATE TABLE IF NOT EXISTS sales_quotation_items (
  id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES sales_quotations(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL,
  item_type VARCHAR(20) DEFAULT 'inventory' CHECK (item_type IN ('inventory', 'custom')),
  product_id INTEGER, -- Removed FK constraint to avoid schema dependency
  product_name VARCHAR(500) NOT NULL,
  quantity DECIMAL(15, 2) NOT NULL,
  unit_price DECIMAL(15, 2) NOT NULL,
  total DECIMAL(15, 2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_quotation_items_quotation ON sales_quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_sales_quotation_items_product ON sales_quotation_items(product_id);

-- Generate quotation number function
CREATE OR REPLACE FUNCTION generate_quotation_number()
RETURNS TEXT AS $$
DECLARE
  new_number TEXT;
  year_part TEXT;
  sequence_part INTEGER;
BEGIN
  year_part := TO_CHAR(NOW(), 'YYYY');
  
  SELECT COALESCE(MAX(CAST(SUBSTRING(quotation_number FROM 'QT-' || year_part || '-(.*)') AS INTEGER)), 0) + 1
  INTO sequence_part
  FROM sales_quotations
  WHERE quotation_number LIKE 'QT-' || year_part || '-%';
  
  new_number := 'QT-' || year_part || '-' || LPAD(sequence_part::TEXT, 4, '0');
  RETURN new_number;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE sales_quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_quotation_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to sales_quotations" ON sales_quotations;
DROP POLICY IF EXISTS "Allow authenticated access to sales_quotation_items" ON sales_quotation_items;

CREATE POLICY "Allow authenticated access to sales_quotations" ON sales_quotations FOR ALL USING (true);
CREATE POLICY "Allow authenticated access to sales_quotation_items" ON sales_quotation_items FOR ALL USING (true);

GRANT ALL ON sales_quotations TO authenticated;
GRANT ALL ON sales_quotation_items TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE sales_quotations_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE sales_quotation_items_id_seq TO authenticated;
