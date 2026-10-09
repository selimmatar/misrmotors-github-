-- Check warehouse transfers and their items
SELECT 
  t.transfer_id,
  t.transfer_number,
  t.status,
  t.source_warehouse_id,
  t.destination_warehouse_id,
  t.completion_date,
  ti.product_id,
  ti.product_name,
  ti.quantity_sent,
  p.product_name as actual_product_name
FROM warehouse_transfers t
LEFT JOIN warehouse_transfer_items ti ON t.transfer_id = ti.transfer_id
LEFT JOIN products p ON ti.product_id = p.product_id
ORDER BY t.created_at DESC
LIMIT 10;
