-- Sales Quotation → Sales Order Approval Pipeline
-- ADDITIVE ONLY - No breaking changes to existing sales_orders

-- Step 1: Add entity_type column to distinguish quotations from sales orders
ALTER TABLE sales_orders 
ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) DEFAULT 'sales_order' 
  CHECK (entity_type IN ('quotation', 'sales_order'));

-- Step 2: Add quotation-specific fields
ALTER TABLE sales_orders
ADD COLUMN IF NOT EXISTS quotation_version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS parent_quotation_id INTEGER REFERENCES sales_orders(so_id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS quotation_validity_days INTEGER DEFAULT 30,
ADD COLUMN IF NOT EXISTS quotation_expiry_date DATE,
ADD COLUMN IF NOT EXISTS submitted_for_approval_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS approved_by_customer_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
ADD COLUMN IF NOT EXISTS converted_to_so_id INTEGER REFERENCES sales_orders(so_id) ON DELETE SET NULL;

-- Step 3: Extend status enum to support quotation lifecycle
ALTER TABLE sales_orders DROP CONSTRAINT IF EXISTS sales_orders_status_check;

ALTER TABLE sales_orders ADD CONSTRAINT sales_orders_status_check 
CHECK (status IN (
  -- Quotation lifecycle (NEW)
  'draft_quotation',
  'pending_approval',
  'approved_quotation',
  'rejected_quotation',
  'expired_quotation',
  
  -- Existing SO lifecycle (UNCHANGED)
  'draft',
  'pending',
  'pending_accountant',
  'accountant_approved',
  'ready_for_delivery',
  'shipped',
  'delivered',
  'cancelled'
));

-- Step 4: Create quotation revisions tracking table
-- Note: revised_by stores user UUID but FK constraint added conditionally below
CREATE TABLE IF NOT EXISTS quotation_revisions (
  revision_id SERIAL PRIMARY KEY,
  quotation_id INTEGER NOT NULL REFERENCES sales_orders(so_id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  revised_at TIMESTAMPTZ DEFAULT NOW(),
  revised_by UUID, -- FK constraint added below if users(id) exists
  change_summary TEXT,
  snapshot JSONB NOT NULL,
  UNIQUE(quotation_id, version_number)
);

CREATE INDEX IF NOT EXISTS idx_quotation_revisions_quotation ON quotation_revisions(quotation_id);
CREATE INDEX IF NOT EXISTS idx_quotation_revisions_version ON quotation_revisions(quotation_id, version_number DESC);

-- Add FK constraint to users table if it uses UUID-based id column (like sales_orders does)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'users' 
      AND column_name = 'id'
      AND data_type = 'uuid'
  ) THEN
    ALTER TABLE quotation_revisions
    DROP CONSTRAINT IF EXISTS fk_quotation_revisions_user;
    
    ALTER TABLE quotation_revisions
    ADD CONSTRAINT fk_quotation_revisions_user
    FOREIGN KEY (revised_by) REFERENCES users(id);
    
    RAISE NOTICE 'Added FK constraint: quotation_revisions.revised_by -> users(id)';
  ELSE
    RAISE NOTICE 'Skipped FK constraint: users(id) column not found (using INTEGER-based user_id instead?)';
  END IF;
END $$;

-- Step 5: Create function to convert quotation to sales order
CREATE OR REPLACE FUNCTION convert_quotation_to_sales_order(
  p_quotation_id INTEGER,
  p_approved_by_user UUID
) RETURNS INTEGER AS $$
DECLARE
  v_new_so_id INTEGER;
  v_quot_data RECORD;
  v_new_so_number TEXT;
BEGIN
  -- Validate quotation exists and is approved
  SELECT * INTO v_quot_data 
  FROM sales_orders 
  WHERE so_id = p_quotation_id 
    AND entity_type = 'quotation'
    AND status = 'approved_quotation';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found or not approved';
  END IF;
  
  -- Generate new SO number (format: SO-YYYY-XXXX)
  SELECT 'SO-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD((
    SELECT COALESCE(MAX(CAST(SUBSTRING(so_number FROM 'SO-[0-9]{4}-(.*)') AS INTEGER)), 0) + 1
    FROM sales_orders
    WHERE so_number LIKE 'SO-' || TO_CHAR(NOW(), 'YYYY') || '-%'
  )::TEXT, 4, '0') INTO v_new_so_number;
  
  -- Insert new sales order (deep copy from quotation)
  INSERT INTO sales_orders (
    so_number,
    customer_id,
    order_date,
    delivery_date,
    delivery_address,
    delivery_contact_name,
    delivery_contact_phone,
    subtotal,
    discount_type,
    discount_value,
    discount_amount,
    total,
    payment_terms,
    payment_type,
    installments,
    schedule_entries,
    schedule_mode,
    down_payment_due_date,
    so_type,
    notes,
    entity_type,
    status,
    created_by,
    approved_by,
    parent_quotation_id
  ) VALUES (
    v_new_so_number,
    v_quot_data.customer_id,
    CURRENT_DATE, -- Use today as order date
    v_quot_data.delivery_date,
    v_quot_data.delivery_address,
    v_quot_data.delivery_contact_name,
    v_quot_data.delivery_contact_phone,
    v_quot_data.subtotal,
    v_quot_data.discount_type,
    v_quot_data.discount_value,
    v_quot_data.discount_amount,
    v_quot_data.total,
    v_quot_data.payment_terms,
    v_quot_data.payment_type,
    v_quot_data.installments,
    v_quot_data.schedule_entries,
    v_quot_data.schedule_mode,
    v_quot_data.down_payment_due_date,
    v_quot_data.so_type,
    'Converted from quotation ' || v_quot_data.so_number || COALESCE(E'\n\n' || v_quot_data.notes, ''),
    'sales_order', -- Entity type becomes sales_order
    'pending_accountant', -- Start normal SO workflow
    v_quot_data.created_by,
    p_approved_by_user,
    p_quotation_id
  ) RETURNING so_id INTO v_new_so_id;
  
  -- Copy line items to new SO
  INSERT INTO sales_order_items (
    so_id, 
    product_id, 
    product_name, 
    quantity, 
    unit_price, 
    total, 
    item_category,
    item_type,
    outsourced_name,
    outsourced_description,
    outsourced_unit
  )
  SELECT 
    v_new_so_id,
    product_id,
    product_name,
    quantity,
    unit_price,
    total,
    item_category,
    item_type,
    outsourced_name,
    outsourced_description,
    outsourced_unit
  FROM sales_order_items
  WHERE so_id = p_quotation_id;
  
  -- Update original quotation with conversion link
  UPDATE sales_orders
  SET 
    converted_to_so_id = v_new_so_id,
    approved_by_customer_at = NOW()
  WHERE so_id = p_quotation_id;
  
  RETURN v_new_so_id;
END;
$$ LANGUAGE plpgsql;

-- Step 6: Create function to save quotation revision
CREATE OR REPLACE FUNCTION save_quotation_revision(
  p_quotation_id INTEGER,
  p_revised_by UUID,
  p_change_summary TEXT
) RETURNS INTEGER AS $$
DECLARE
  v_current_version INTEGER;
  v_quot_data RECORD;
  v_snapshot JSONB;
BEGIN
  -- Get current quotation data
  SELECT * INTO v_quot_data FROM sales_orders WHERE so_id = p_quotation_id AND entity_type = 'quotation';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation not found';
  END IF;
  
  v_current_version := v_quot_data.quotation_version;
  
  -- Create snapshot of current state
  v_snapshot := jsonb_build_object(
    'so_number', v_quot_data.so_number,
    'customer_id', v_quot_data.customer_id,
    'subtotal', v_quot_data.subtotal,
    'discount_type', v_quot_data.discount_type,
    'discount_value', v_quot_data.discount_value,
    'discount_amount', v_quot_data.discount_amount,
    'total', v_quot_data.total,
    'payment_terms', v_quot_data.payment_terms,
    'payment_type', v_quot_data.payment_type,
    'installments', v_quot_data.installments,
    'schedule_entries', v_quot_data.schedule_entries,
    'notes', v_quot_data.notes,
    'status', v_quot_data.status
  );
  
  -- Insert revision record
  INSERT INTO quotation_revisions (
    quotation_id,
    version_number,
    revised_by,
    change_summary,
    snapshot
  ) VALUES (
    p_quotation_id,
    v_current_version,
    p_revised_by,
    p_change_summary,
    v_snapshot
  );
  
  -- Increment version on quotation
  UPDATE sales_orders
  SET quotation_version = v_current_version + 1
  WHERE so_id = p_quotation_id;
  
  RETURN v_current_version + 1;
END;
$$ LANGUAGE plpgsql;

-- Step 7: Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sales_orders_entity_type ON sales_orders(entity_type);
CREATE INDEX IF NOT EXISTS idx_sales_orders_quotation_status ON sales_orders(status) WHERE entity_type = 'quotation';
CREATE INDEX IF NOT EXISTS idx_sales_orders_converted_to ON sales_orders(converted_to_so_id) WHERE converted_to_so_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sales_orders_parent_quotation ON sales_orders(parent_quotation_id) WHERE parent_quotation_id IS NOT NULL;

-- Step 8: Add RLS policies for quotation_revisions table
ALTER TABLE quotation_revisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated access to quotation_revisions" ON quotation_revisions;
CREATE POLICY "Allow authenticated access to quotation_revisions" 
  ON quotation_revisions FOR ALL USING (true);

GRANT ALL ON quotation_revisions TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE quotation_revisions_revision_id_seq TO authenticated;

-- Step 9: Add comments for documentation
COMMENT ON COLUMN sales_orders.entity_type IS 'Distinguishes quotations from sales orders';
COMMENT ON COLUMN sales_orders.quotation_version IS 'Increments each time quotation is revised and resubmitted';
COMMENT ON COLUMN sales_orders.converted_to_so_id IS 'Links approved quotation to the SO it was converted to';
COMMENT ON TABLE quotation_revisions IS 'Stores historical snapshots of quotation versions for audit trail';
COMMENT ON FUNCTION convert_quotation_to_sales_order IS 'Converts an approved quotation into a sales order, preserving all data';
COMMENT ON FUNCTION save_quotation_revision IS 'Saves current quotation state as a revision before making changes';
