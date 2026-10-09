-- Simplify lost_sales table to only essential fields
-- Drop existing table and recreate with simplified structure

DROP TABLE IF EXISTS lost_sales CASCADE;

CREATE TABLE lost_sales (
    lost_sale_id SERIAL PRIMARY KEY,
    
    -- Essential fields only
    requested_item_name VARCHAR(255) NOT NULL, -- Product name
    customer_name VARCHAR(255),
    requested_quantity INTEGER DEFAULT 1,
    customer_email VARCHAR(255),
    customer_phone VARCHAR(50),
    
    -- Metadata
    request_date TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX idx_lost_sales_request_date ON lost_sales(request_date DESC);
CREATE INDEX idx_lost_sales_item_name ON lost_sales(requested_item_name);

-- Create a simplified view for reporting
CREATE OR REPLACE VIEW report_lost_sales AS
SELECT 
    lost_sale_id,
    requested_item_name as product_name,
    customer_name,
    requested_quantity as quantity,
    customer_email,
    customer_phone,
    request_date,
    created_at
FROM lost_sales
ORDER BY request_date DESC;

-- Create summary view
CREATE OR REPLACE VIEW report_lost_sales_summary AS
SELECT 
    DATE_TRUNC('month', request_date) as month,
    COUNT(*) as total_requests,
    COUNT(DISTINCT customer_email) as unique_customers,
    COUNT(DISTINCT requested_item_name) as unique_items,
    SUM(requested_quantity) as total_quantity_requested
FROM lost_sales
GROUP BY DATE_TRUNC('month', request_date)
ORDER BY month DESC;

-- Create top lost items view
CREATE OR REPLACE VIEW report_top_lost_items AS
SELECT 
    requested_item_name as product_name,
    COUNT(*) as request_count,
    SUM(requested_quantity) as total_quantity_requested,
    COUNT(DISTINCT customer_email) as unique_customers,
    MAX(request_date) as last_requested
FROM lost_sales
GROUP BY requested_item_name
ORDER BY request_count DESC;
