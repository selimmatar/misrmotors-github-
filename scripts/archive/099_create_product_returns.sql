-- Create product_returns table for tracking returned items from deliveries
CREATE TABLE IF NOT EXISTS product_returns (
  return_id SERIAL PRIMARY KEY,
  permit_id VARCHAR(100) NOT NULL,
  so_id INTEGER REFERENCES sales_orders(so_id),
  customer_id INTEGER REFERENCES customers(customer_id),
  
  -- Return details
  status VARCHAR(50) DEFAULT 'pending_warehouse' CHECK (status IN ('pending_warehouse', 'assigned_warehouse', 'received', 'restocked', 'rejected')),
  total_items_returned INTEGER DEFAULT 0,
  
  -- Who initiated the return
  initiated_by VARCHAR(255),
  initiated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Warehouse assignment (filled by warehouse manager)
  assigned_warehouse_id INTEGER REFERENCES warehouses(warehouse_id),
  assigned_by VARCHAR(255),
  assigned_at TIMESTAMP WITH TIME ZONE,
  
  -- Receipt confirmation (when items arrive at warehouse)
  received_by VARCHAR(255),
  received_at TIMESTAMP WITH TIME ZONE,
  
  -- Notes
  notes TEXT,
  warehouse_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create return_items table for individual returned items
CREATE TABLE IF NOT EXISTS return_items (
  return_item_id SERIAL PRIMARY KEY,
  return_id INTEGER REFERENCES product_returns(return_id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(product_id),
  product_name VARCHAR(255),
  sku VARCHAR(100),
  
  -- Quantities
  original_quantity INTEGER NOT NULL,
  returned_quantity INTEGER NOT NULL,
  
  -- Reason for return
  return_reason VARCHAR(100) CHECK (return_reason IN ('damaged', 'wrong_item', 'customer_refused', 'excess_quantity', 'quality_issue', 'other')),
  reason_notes TEXT,
  
  -- Item condition
  item_condition VARCHAR(50) DEFAULT 'good' CHECK (item_condition IN ('good', 'damaged', 'defective', 'unsellable')),
  
  -- Whether this item was restocked
  restocked BOOLEAN DEFAULT FALSE,
  restocked_at TIMESTAMP WITH TIME ZONE,
  restocked_warehouse_id INTEGER REFERENCES warehouses(warehouse_id),
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_product_returns_status ON product_returns(status);
CREATE INDEX IF NOT EXISTS idx_product_returns_permit ON product_returns(permit_id);
CREATE INDEX IF NOT EXISTS idx_product_returns_so ON product_returns(so_id);
CREATE INDEX IF NOT EXISTS idx_return_items_return ON return_items(return_id);
CREATE INDEX IF NOT EXISTS idx_return_items_product ON return_items(product_id);
