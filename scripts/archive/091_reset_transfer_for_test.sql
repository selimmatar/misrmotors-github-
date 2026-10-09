-- Reset a transfer to pending for testing
UPDATE warehouse_transfers 
SET status = 'pending', completion_date = NULL
WHERE transfer_id = 6;

-- Verify the reset
SELECT transfer_id, transfer_number, status, source_warehouse_id, destination_warehouse_id
FROM warehouse_transfers
WHERE transfer_id = 6;

-- Check what items are in this transfer
SELECT 
  wti.item_id,
  wti.product_id,
  p.product_name,
  wti.quantity_requested,
  wti.quantity_sent
FROM warehouse_transfer_items wti
JOIN products p ON p.product_id = wti.product_id
WHERE wti.transfer_id = 6;
