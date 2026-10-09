-- Create the associative entity (baby entity) between suppliers and products
CREATE TABLE IF NOT EXISTS supplier_products (
  id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(supplier_id) ON DELETE CASCADE,
  product_id INT REFERENCES products(product_id) ON DELETE CASCADE,
  supplier_sku VARCHAR(50),           -- Supplier's internal SKU for this product
  unit_cost NUMERIC(10,2),            -- Specific cost from this supplier
  lead_time_days INT,                 -- Days to deliver
  is_preferred BOOLEAN DEFAULT FALSE, -- Is this the primary supplier?
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(supplier_id, product_id)     -- Prevent duplicate links
);

-- Index for performance
CREATE INDEX idx_supplier_products_supplier ON supplier_products(supplier_id);
CREATE INDEX idx_supplier_products_product ON supplier_products(product_id);
