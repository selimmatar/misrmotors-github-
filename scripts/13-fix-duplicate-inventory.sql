-- Remove duplicate inventory records, keeping only the record with the highest quantity for each product
DELETE FROM inventory
WHERE inventory_id NOT IN (
  SELECT DISTINCT ON (product_id) inventory_id
  FROM inventory
  ORDER BY product_id, quantity DESC, inventory_id ASC
);

-- Verify the fix
SELECT product_id, COUNT(*) as count
FROM inventory
GROUP BY product_id
HAVING COUNT(*) > 1;
