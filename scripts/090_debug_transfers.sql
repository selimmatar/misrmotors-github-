-- Check all transfers and their items
SELECT 
  t.transfer_id,
  t.transfer_number,
  t.status,
  t.source_warehouse_id,
  t.destination_warehouse_id,
  sw.warehouse_name as source_warehouse,
  dw.warehouse_name as dest_warehouse,
  t.created_at
FROM warehouse_transfers t
LEFT JOIN warehouses sw ON sw.warehouse_id = t.source_warehouse_id
LEFT JOIN warehouses dw ON dw.warehouse_id = t.destination_warehouse_id
ORDER BY t.created_at DESC
LIMIT 10;

-- Check inventory by warehouse
SELECT 
  i.inventory_id,
  i.product_id,
  p.product_name,
  i.warehouse_id,
  w.warehouse_name,
  i.quantity
FROM inventory i
LEFT JOIN products p ON p.product_id = i.product_id
LEFT JOIN warehouses w ON w.warehouse_id = i.warehouse_id
ORDER BY i.warehouse_id, p.product_name;
