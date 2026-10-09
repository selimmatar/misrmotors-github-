-- Supplier Quote Comparison Feature
-- Isolated feature for comparing supplier quotations against sales quotations
-- This script must be run AFTER script 072 (sales_quotations table creation)

-- Table 1: Supplier Quote Uploads
CREATE TABLE IF NOT EXISTS supplier_quote_uploads (
  id SERIAL PRIMARY KEY,
  sales_quotation_id INTEGER REFERENCES sales_quotations(id) ON DELETE CASCADE,
  supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
  supplier_name_raw VARCHAR(255) NOT NULL, -- Manual entry if supplier not in system
  file_url TEXT NOT NULL, -- Vercel Blob URL
  file_name VARCHAR(500) NOT NULL,
  currency VARCHAR(10) DEFAULT 'EGP',
  status VARCHAR(50) DEFAULT 'uploaded' CHECK (status IN ('uploaded', 'extracting', 'extracted', 'failed')),
  extraction_error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(255),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_quote_uploads_sales_quotation ON supplier_quote_uploads(sales_quotation_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quote_uploads_supplier ON supplier_quote_uploads(supplier_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quote_uploads_status ON supplier_quote_uploads(status);

-- Table 2: Supplier Quote Items (Extracted)
CREATE TABLE IF NOT EXISTS supplier_quote_items (
  id SERIAL PRIMARY KEY,
  upload_id INTEGER NOT NULL REFERENCES supplier_quote_uploads(id) ON DELETE CASCADE,
  line_no INTEGER NOT NULL, -- Line number in PDF
  product_code_raw VARCHAR(255), -- SKU/Code from PDF
  product_name_raw VARCHAR(500) NOT NULL, -- Product name from PDF
  unit_price DECIMAL(15, 2) NOT NULL,
  qty DECIMAL(15, 2), -- Quantity if specified
  unit VARCHAR(50), -- Unit of measure
  page_no INTEGER, -- PDF page number
  raw_text TEXT, -- Original extracted text
  extraction_confidence DECIMAL(5, 2) DEFAULT 0.0 CHECK (extraction_confidence >= 0 AND extraction_confidence <= 100), -- 0-100
  -- Changed from products(id) to products(product_id) to match actual table structure
  matched_product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
  match_confidence DECIMAL(5, 2) DEFAULT 0.0 CHECK (match_confidence >= 0 AND match_confidence <= 100), -- 0-100
  manually_matched BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_quote_items_upload ON supplier_quote_items(upload_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quote_items_product ON supplier_quote_items(matched_product_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quote_items_confidence ON supplier_quote_items(match_confidence);

-- Table 3: Quote Comparison Runs
CREATE TABLE IF NOT EXISTS quote_compare_runs (
  id SERIAL PRIMARY KEY,
  sales_quotation_id INTEGER NOT NULL,
  total_items INTEGER DEFAULT 0,
  matched_items INTEGER DEFAULT 0,
  unmatched_items INTEGER DEFAULT 0,
  status VARCHAR(50) DEFAULT 'draft' CHECK (status IN ('draft', 'completed', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(255)
);

CREATE INDEX IF NOT EXISTS idx_quote_compare_runs_sales_quotation ON quote_compare_runs(sales_quotation_id);
CREATE INDEX IF NOT EXISTS idx_quote_compare_runs_created ON quote_compare_runs(created_at DESC);

-- Table 4: Quote Comparison Recommendations
CREATE TABLE IF NOT EXISTS quote_compare_recommendations (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES quote_compare_runs(id) ON DELETE CASCADE,
  -- Changed from products(id) to products(product_id) to match actual table structure
  product_id INTEGER REFERENCES products(product_id) ON DELETE SET NULL,
  product_name VARCHAR(500) NOT NULL, -- Fallback for custom items
  requested_qty DECIMAL(15, 2) NOT NULL,
  best_upload_id INTEGER REFERENCES supplier_quote_uploads(id) ON DELETE SET NULL,
  best_supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
  best_supplier_name VARCHAR(255) NOT NULL,
  best_unit_price DECIMAL(15, 2) NOT NULL,
  best_currency VARCHAR(10) DEFAULT 'EGP',
  total_price DECIMAL(15, 2) GENERATED ALWAYS AS (requested_qty * best_unit_price) STORED,
  evidence JSONB, -- {pdf_file, page_no, line_no, raw_text, extraction_confidence}
  confidence DECIMAL(5, 2) DEFAULT 0.0 CHECK (confidence >= 0 AND confidence <= 100),
  override_supplier_id INTEGER REFERENCES suppliers(supplier_id) ON DELETE SET NULL,
  override_supplier_name VARCHAR(255),
  override_unit_price DECIMAL(15, 2),
  override_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quote_compare_recommendations_run ON quote_compare_recommendations(run_id);
CREATE INDEX IF NOT EXISTS idx_quote_compare_recommendations_product ON quote_compare_recommendations(product_id);
CREATE INDEX IF NOT EXISTS idx_quote_compare_recommendations_confidence ON quote_compare_recommendations(confidence);

-- RLS Policies (Enable RLS on all tables)
ALTER TABLE supplier_quote_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE supplier_quote_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_compare_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quote_compare_recommendations ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Allow authenticated access to supplier_quote_uploads" ON supplier_quote_uploads;
DROP POLICY IF EXISTS "Allow authenticated access to supplier_quote_items" ON supplier_quote_items;
DROP POLICY IF EXISTS "Allow authenticated access to quote_compare_runs" ON quote_compare_runs;
DROP POLICY IF EXISTS "Allow authenticated access to quote_compare_recommendations" ON quote_compare_recommendations;

-- Allow authenticated users to read/write (adjust based on your auth setup)
CREATE POLICY "Allow authenticated access to supplier_quote_uploads" ON supplier_quote_uploads FOR ALL USING (true);
CREATE POLICY "Allow authenticated access to supplier_quote_items" ON supplier_quote_items FOR ALL USING (true);
CREATE POLICY "Allow authenticated access to quote_compare_runs" ON quote_compare_runs FOR ALL USING (true);
CREATE POLICY "Allow authenticated access to quote_compare_recommendations" ON quote_compare_recommendations FOR ALL USING (true);

-- Grant permissions
GRANT ALL ON supplier_quote_uploads TO authenticated;
GRANT ALL ON supplier_quote_items TO authenticated;
GRANT ALL ON quote_compare_runs TO authenticated;
GRANT ALL ON quote_compare_recommendations TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE supplier_quote_uploads_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE supplier_quote_items_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE quote_compare_runs_id_seq TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE quote_compare_recommendations_id_seq TO authenticated;
