-- First, delete any existing inventory records to avoid duplicates
DELETE FROM inventory;

-- Add inventory records for all products
INSERT INTO inventory (product_id, quantity, reorder_point, location) VALUES
(1, 15, 5, 'Main Warehouse'),
(2, 20, 8, 'Main Warehouse'),
(3, 12, 4, 'Main Warehouse'),
(4, 25, 10, 'Main Warehouse'),
(5, 18, 6, 'Main Warehouse'),
(6, 30, 12, 'Main Warehouse'),
(7, 22, 8, 'Main Warehouse'),
(8, 40, 15, 'Main Warehouse');
