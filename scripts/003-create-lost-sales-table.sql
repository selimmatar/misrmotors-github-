-- Create lost_sales table to track items requested but not available in stock
CREATE TABLE IF NOT EXISTS lost_sales (
    lost_sale_id SERIAL PRIMARY KEY,
    
    -- Request information
    request_date TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    request_source VARCHAR(100) DEFAULT 'email', -- email, phone, web, etc.
    request_reference VARCHAR(255), -- email subject, order reference, etc.
    
    -- Customer information (optional - may not always have customer details)
    customer_email VARCHAR(255),
    customer_name VARCHAR(255),
    customer_id INTEGER REFERENCES customers(customer_id),
    
    -- Product information
    requested_item_name VARCHAR(255) NOT NULL, -- What was requested (may not match our product names)
    requested_quantity INTEGER DEFAULT 1,
    matched_product_id INTEGER REFERENCES products(product_id), -- If we found a matching product but it's out of stock
    matched_sku VARCHAR(100),
    
    -- Pricing (if known)
    estimated_unit_price NUMERIC(12,2),
    estimated_total_value NUMERIC(12,2),
    
    -- Status tracking
    status VARCHAR(50) DEFAULT 'pending', -- pending, followed_up, converted, dismissed
    follow_up_date DATE,
    notes TEXT,
    
    -- Metadata
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    created_by INTEGER REFERENCES users(user_id)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_lost_sales_request_date ON lost_sales(request_date DESC);
CREATE INDEX IF NOT EXISTS idx_lost_sales_status ON lost_sales(status);
CREATE INDEX IF NOT EXISTS idx_lost_sales_matched_product ON lost_sales(matched_product_id);
CREATE INDEX IF NOT EXISTS idx_lost_sales_customer ON lost_sales(customer_id);

-- Create a view for lost sales reporting
CREATE OR REPLACE VIEW report_lost_sales AS
SELECT 
    ls.lost_sale_id,
    ls.request_date,
    ls.request_source,
    ls.request_reference,
    ls.customer_email,
    COALESCE(ls.customer_name, c.customer_name) as customer_name,
    ls.customer_id,
    ls.requested_item_name,
    ls.requested_quantity,
    ls.matched_product_id,
    COALESCE(ls.matched_sku, p.sku) as matched_sku,
    p.product_name as matched_product_name,
    pc.category_name as product_category,
    ls.estimated_unit_price,
    ls.estimated_total_value,
    ls.status,
    ls.follow_up_date,
    ls.notes,
    -- Current inventory status (if product matched)
    COALESCE(i.quantity, 0) as current_stock,
    i.reorder_point,
    CASE 
        WHEN i.quantity IS NULL THEN 'No Match'
        WHEN i.quantity = 0 THEN 'Out of Stock'
        WHEN i.quantity < COALESCE(i.reorder_point, 0) THEN 'Low Stock'
        ELSE 'In Stock'
    END as current_stock_status
FROM lost_sales ls
LEFT JOIN customers c ON ls.customer_id = c.customer_id
LEFT JOIN products p ON ls.matched_product_id = p.product_id
LEFT JOIN product_categories pc ON p.category_id = pc.category_id
LEFT JOIN inventory i ON p.product_id = i.product_id;

-- Create a summary view for lost sales analytics
CREATE OR REPLACE VIEW report_lost_sales_summary AS
SELECT 
    DATE_TRUNC('month', request_date) as month,
    COUNT(*) as total_requests,
    COUNT(DISTINCT customer_email) as unique_customers,
    COUNT(DISTINCT requested_item_name) as unique_items_requested,
    COUNT(CASE WHEN matched_product_id IS NOT NULL THEN 1 END) as matched_to_products,
    COUNT(CASE WHEN matched_product_id IS NULL THEN 1 END) as unmatched_items,
    COUNT(CASE WHEN status = 'converted' THEN 1 END) as converted_sales,
    COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_follow_up,
    SUM(COALESCE(estimated_total_value, 0)) as total_lost_value,
    SUM(CASE WHEN status = 'converted' THEN COALESCE(estimated_total_value, 0) ELSE 0 END) as recovered_value
FROM lost_sales
GROUP BY DATE_TRUNC('month', request_date)
ORDER BY month DESC;

-- Create a view for top lost items (most frequently requested but unavailable)
CREATE OR REPLACE VIEW report_top_lost_items AS
SELECT 
    LOWER(TRIM(requested_item_name)) as item_name_normalized,
    requested_item_name as sample_name,
    COUNT(*) as request_count,
    SUM(requested_quantity) as total_quantity_requested,
    COUNT(DISTINCT customer_email) as unique_requesters,
    SUM(COALESCE(estimated_total_value, 0)) as total_potential_value,
    MAX(request_date) as last_requested,
    MIN(request_date) as first_requested,
    -- Check if any matching product exists now
    MAX(matched_product_id) as matched_product_id,
    MAX(p.product_name) as matched_product_name
FROM lost_sales ls
LEFT JOIN products p ON ls.matched_product_id = p.product_id
GROUP BY LOWER(TRIM(requested_item_name)), requested_item_name
ORDER BY request_count DESC, total_potential_value DESC;
