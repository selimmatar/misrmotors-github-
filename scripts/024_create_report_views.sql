-- =====================================================
-- DATABASE VIEWS FOR REPORTS
-- These views provide pre-calculated report data
-- =====================================================

-- 1. SALES SUMMARY VIEW
-- Monthly sales aggregation with totals
CREATE OR REPLACE VIEW report_sales_summary AS
SELECT 
  DATE_TRUNC('month', so.order_date)::date as month,
  COUNT(*) as total_orders,
  COUNT(CASE WHEN so.status = 'completed' OR so.status = 'delivered' THEN 1 END) as completed_orders,
  COUNT(CASE WHEN so.status = 'pending_ceo' OR so.status = 'pending_accountant' THEN 1 END) as pending_orders,
  SUM(so.total) as total_revenue,
  AVG(so.total) as avg_order_value,
  COUNT(DISTINCT so.customer_id) as unique_customers
FROM sales_orders so
GROUP BY DATE_TRUNC('month', so.order_date)
ORDER BY month DESC;

-- 2. SALES DETAILS VIEW
-- Detailed sales with customer info
CREATE OR REPLACE VIEW report_sales_details AS
SELECT 
  so.so_id,
  so.so_number,
  so.order_date,
  so.delivery_date,
  so.total,
  so.status,
  so.payment_terms,
  so.installments,
  c.customer_id,
  c.customer_name,
  c.email as customer_email,
  c.phone as customer_phone,
  c.city as customer_city,
  c.country as customer_country
FROM sales_orders so
LEFT JOIN customers c ON so.customer_id = c.customer_id
ORDER BY so.order_date DESC;

-- 3. SALES BY CUSTOMER VIEW
-- Customer sales aggregation
CREATE OR REPLACE VIEW report_sales_by_customer AS
SELECT 
  c.customer_id,
  c.customer_name,
  c.email,
  c.phone,
  c.city,
  c.country,
  COUNT(so.so_id) as total_orders,
  COALESCE(SUM(so.total), 0) as total_spent,
  COALESCE(AVG(so.total), 0) as avg_order_value,
  MAX(so.order_date) as last_order_date
FROM customers c
LEFT JOIN sales_orders so ON c.customer_id = so.customer_id
GROUP BY c.customer_id, c.customer_name, c.email, c.phone, c.city, c.country
ORDER BY total_spent DESC;

-- 4. PURCHASE SUMMARY VIEW
-- Monthly purchase aggregation
CREATE OR REPLACE VIEW report_purchase_summary AS
SELECT 
  DATE_TRUNC('month', po.order_date)::date as month,
  COUNT(*) as total_orders,
  COUNT(CASE WHEN po.status = 'received' THEN 1 END) as received_orders,
  COUNT(CASE WHEN po.status = 'pending_ceo' THEN 1 END) as pending_orders,
  SUM(po.total) as total_amount,
  SUM(COALESCE(po.tax_amount, 0)) as total_tax,
  SUM(COALESCE(po.other_costs, 0)) as total_other_costs,
  AVG(po.total) as avg_order_value,
  COUNT(DISTINCT po.supplier_id) as unique_suppliers
FROM purchase_orders po
GROUP BY DATE_TRUNC('month', po.order_date)
ORDER BY month DESC;

-- 5. PURCHASE DETAILS VIEW
-- Detailed purchases with supplier info
CREATE OR REPLACE VIEW report_purchase_details AS
SELECT 
  po.po_id,
  po.po_number,
  po.order_date,
  po.delivery_date,
  po.total,
  po.tax_amount,
  po.other_costs,
  po.status,
  po.payment_terms,
  po.installments,
  po.currency,
  po.cost_finalized,
  s.supplier_id,
  s.supplier_name,
  s.email as supplier_email,
  s.phone as supplier_phone,
  s.city as supplier_city,
  s.country as supplier_country,
  s.lead_time_days
FROM purchase_orders po
LEFT JOIN suppliers s ON po.supplier_id = s.supplier_id
ORDER BY po.order_date DESC;

-- 6. PURCHASE BY SUPPLIER VIEW
-- Supplier purchase aggregation
CREATE OR REPLACE VIEW report_purchase_by_supplier AS
SELECT 
  s.supplier_id,
  s.supplier_name,
  s.email,
  s.phone,
  s.city,
  s.country,
  s.lead_time_days,
  COUNT(po.po_id) as total_orders,
  COALESCE(SUM(po.total), 0) as total_amount,
  COALESCE(AVG(po.total), 0) as avg_order_value,
  MAX(po.order_date) as last_order_date
FROM suppliers s
LEFT JOIN purchase_orders po ON s.supplier_id = po.supplier_id
GROUP BY s.supplier_id, s.supplier_name, s.email, s.phone, s.city, s.country, s.lead_time_days
ORDER BY total_amount DESC;

-- 7. INVENTORY VALUATION VIEW
-- Current inventory with values
CREATE OR REPLACE VIEW report_inventory_valuation AS
SELECT 
  i.inventory_id,
  i.product_id,
  p.product_name,
  p.sku,
  pc.category_name as category,
  i.quantity,
  i.unit_cost,
  (i.quantity * i.unit_cost) as total_value,
  i.reorder_point,
  i.location,
  CASE 
    WHEN i.quantity <= 0 THEN 'Out of Stock'
    WHEN i.quantity <= i.reorder_point THEN 'Low Stock'
    ELSE 'In Stock'
  END as stock_status,
  i.last_updated
FROM inventory i
JOIN products p ON i.product_id = p.product_id
LEFT JOIN product_categories pc ON p.category_id = pc.category_id
ORDER BY total_value DESC;

-- 8. INVENTORY SUMMARY BY CATEGORY VIEW
CREATE OR REPLACE VIEW report_inventory_by_category AS
SELECT 
  COALESCE(pc.category_name, 'Uncategorized') as category,
  COUNT(*) as total_products,
  SUM(i.quantity) as total_quantity,
  SUM(i.quantity * i.unit_cost) as total_value,
  AVG(i.unit_cost) as avg_unit_cost,
  SUM(CASE WHEN i.quantity <= i.reorder_point THEN 1 ELSE 0 END) as low_stock_count,
  SUM(CASE WHEN i.quantity <= 0 THEN 1 ELSE 0 END) as out_of_stock_count
FROM inventory i
JOIN products p ON i.product_id = p.product_id
LEFT JOIN product_categories pc ON p.category_id = pc.category_id
GROUP BY pc.category_name
ORDER BY total_value DESC;

-- 9. AR AGING VIEW
-- Accounts receivable with aging buckets
CREATE OR REPLACE VIEW report_ar_aging AS
SELECT 
  ar.invoice_id,
  ar.invoice_number,
  ar.invoice_date,
  ar.due_date,
  ar.amount as total_amount,
  ar.collected_amount as paid_amount,
  (ar.amount - COALESCE(ar.collected_amount, 0)) as balance_due,
  ar.status,
  ar.payment_terms,
  ar.installment_months,
  ar.months_paid,
  c.customer_id,
  c.customer_name,
  c.email as customer_email,
  c.phone as customer_phone,
  CURRENT_DATE - ar.due_date as days_overdue,
  CASE 
    WHEN ar.status = 'paid' THEN 'Paid'
    WHEN CURRENT_DATE - ar.due_date <= 0 THEN 'Current'
    WHEN CURRENT_DATE - ar.due_date <= 30 THEN '1-30 Days'
    WHEN CURRENT_DATE - ar.due_date <= 60 THEN '31-60 Days'
    WHEN CURRENT_DATE - ar.due_date <= 90 THEN '61-90 Days'
    ELSE '90+ Days'
  END as aging_bucket
FROM accounts_receivable ar
JOIN customers c ON ar.customer_id = c.customer_id
ORDER BY ar.due_date ASC;

-- 10. AR SUMMARY VIEW
CREATE OR REPLACE VIEW report_ar_summary AS
SELECT 
  COUNT(*) as total_invoices,
  SUM(amount) as total_invoiced,
  SUM(COALESCE(collected_amount, 0)) as total_collected,
  SUM(amount - COALESCE(collected_amount, 0)) as total_outstanding,
  COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices,
  COUNT(CASE WHEN status = 'pending' OR status = 'partially_paid' THEN 1 END) as open_invoices,
  COUNT(CASE WHEN status != 'paid' AND CURRENT_DATE > due_date THEN 1 END) as overdue_invoices,
  SUM(CASE WHEN status != 'paid' AND CURRENT_DATE > due_date THEN amount - COALESCE(collected_amount, 0) ELSE 0 END) as overdue_amount
FROM accounts_receivable;

-- 11. AP AGING VIEW
-- Accounts payable with aging buckets
CREATE OR REPLACE VIEW report_ap_aging AS
SELECT 
  ap.invoice_id,
  ap.invoice_number,
  ap.invoice_date,
  ap.due_date,
  ap.amount as total_amount,
  ap.paid_amount,
  (ap.amount - COALESCE(ap.paid_amount, 0)) as balance_due,
  ap.status,
  ap.payment_terms,
  ap.installment_months,
  ap.months_paid,
  s.supplier_id,
  s.supplier_name,
  s.email as supplier_email,
  s.phone as supplier_phone,
  CURRENT_DATE - ap.due_date as days_overdue,
  CASE 
    WHEN ap.status = 'paid' THEN 'Paid'
    WHEN CURRENT_DATE - ap.due_date <= 0 THEN 'Current'
    WHEN CURRENT_DATE - ap.due_date <= 30 THEN '1-30 Days'
    WHEN CURRENT_DATE - ap.due_date <= 60 THEN '31-60 Days'
    WHEN CURRENT_DATE - ap.due_date <= 90 THEN '61-90 Days'
    ELSE '90+ Days'
  END as aging_bucket
FROM accounts_payable ap
JOIN suppliers s ON ap.supplier_id = s.supplier_id
ORDER BY ap.due_date ASC;

-- 12. AP SUMMARY VIEW
CREATE OR REPLACE VIEW report_ap_summary AS
SELECT 
  COUNT(*) as total_invoices,
  SUM(amount) as total_invoiced,
  SUM(COALESCE(paid_amount, 0)) as total_paid,
  SUM(amount - COALESCE(paid_amount, 0)) as total_outstanding,
  COUNT(CASE WHEN status = 'paid' THEN 1 END) as paid_invoices,
  COUNT(CASE WHEN status = 'pending' OR status = 'partially_paid' THEN 1 END) as open_invoices,
  COUNT(CASE WHEN status != 'paid' AND CURRENT_DATE > due_date THEN 1 END) as overdue_invoices,
  SUM(CASE WHEN status != 'paid' AND CURRENT_DATE > due_date THEN amount - COALESCE(paid_amount, 0) ELSE 0 END) as overdue_amount
FROM accounts_payable;

-- 13. FINANCIAL SUMMARY VIEW
-- Combined financial metrics
CREATE OR REPLACE VIEW report_financial_summary AS
SELECT 
  (SELECT COALESCE(SUM(total), 0) FROM sales_orders WHERE status IN ('completed', 'delivered')) as total_revenue,
  (SELECT COALESCE(SUM(total), 0) FROM purchase_orders WHERE status = 'received') as total_expenses,
  (SELECT COALESCE(SUM(total), 0) FROM sales_orders WHERE status IN ('completed', 'delivered')) - 
  (SELECT COALESCE(SUM(total), 0) FROM purchase_orders WHERE status = 'received') as gross_profit,
  (SELECT COALESCE(SUM(amount - COALESCE(collected_amount, 0)), 0) FROM accounts_receivable WHERE status != 'paid') as ar_outstanding,
  (SELECT COALESCE(SUM(amount - COALESCE(paid_amount, 0)), 0) FROM accounts_payable WHERE status != 'paid') as ap_outstanding,
  (SELECT COUNT(*) FROM sales_orders) as total_sales_orders,
  (SELECT COUNT(*) FROM purchase_orders) as total_purchase_orders,
  (SELECT COUNT(*) FROM customers) as total_customers,
  (SELECT COUNT(*) FROM suppliers) as total_suppliers,
  (SELECT COALESCE(SUM(quantity * unit_cost), 0) FROM inventory) as inventory_value;

-- 14. PRODUCT PERFORMANCE VIEW
-- Products with sales performance
CREATE OR REPLACE VIEW report_product_performance AS
SELECT 
  p.product_id,
  p.product_name,
  p.sku,
  pc.category_name as category,
  p.unit_price,
  p.last_landed_cost,
  p.markup_percentage,
  COALESCE(i.quantity, 0) as current_stock,
  COALESCE(i.reorder_point, 0) as reorder_point,
  COALESCE(sales.total_quantity_sold, 0) as total_quantity_sold,
  COALESCE(sales.total_revenue, 0) as total_revenue,
  COALESCE(sales.order_count, 0) as order_count,
  CASE 
    WHEN sales.total_quantity_sold > 0 THEN 
      ROUND((sales.total_revenue - (sales.total_quantity_sold * COALESCE(p.last_landed_cost, 0))) / sales.total_revenue * 100, 2)
    ELSE 0 
  END as profit_margin_pct
FROM products p
LEFT JOIN product_categories pc ON p.category_id = pc.category_id
LEFT JOIN inventory i ON p.product_id = i.product_id
LEFT JOIN (
  SELECT 
    soi.product_id,
    SUM(soi.quantity) as total_quantity_sold,
    SUM(soi.total) as total_revenue,
    COUNT(DISTINCT soi.so_id) as order_count
  FROM sales_order_items soi
  JOIN sales_orders so ON soi.so_id = so.so_id
  WHERE so.status IN ('completed', 'delivered', 'shipped')
  GROUP BY soi.product_id
) sales ON p.product_id = sales.product_id
ORDER BY total_revenue DESC;

-- 15. CASH FLOW VIEW
-- Balance entries for cash flow tracking
CREATE OR REPLACE VIEW report_cash_flow AS
SELECT 
  DATE_TRUNC('month', be.created_at)::date as month,
  SUM(CASE WHEN be.entry_type = 'credit' THEN be.amount ELSE 0 END) as total_inflow,
  SUM(CASE WHEN be.entry_type = 'debit' THEN be.amount ELSE 0 END) as total_outflow,
  SUM(CASE WHEN be.entry_type = 'credit' THEN be.amount ELSE -be.amount END) as net_cash_flow,
  COUNT(*) as transaction_count
FROM balance_entries be
GROUP BY DATE_TRUNC('month', be.created_at)
ORDER BY month DESC;

-- 16. TOP SELLING PRODUCTS VIEW
CREATE OR REPLACE VIEW report_top_products AS
SELECT 
  p.product_id,
  p.product_name,
  p.sku,
  pc.category_name as category,
  SUM(soi.quantity) as total_sold,
  SUM(soi.total) as total_revenue,
  COUNT(DISTINCT so.so_id) as order_count,
  COUNT(DISTINCT so.customer_id) as customer_count
FROM sales_order_items soi
JOIN products p ON soi.product_id = p.product_id
JOIN sales_orders so ON soi.so_id = so.so_id
LEFT JOIN product_categories pc ON p.category_id = pc.category_id
WHERE so.status IN ('completed', 'delivered', 'shipped')
GROUP BY p.product_id, p.product_name, p.sku, pc.category_name
ORDER BY total_revenue DESC
LIMIT 20;
