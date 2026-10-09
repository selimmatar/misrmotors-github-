-- Step 1: Remove ALL duplicate inventory records, keeping only the one with highest quantity
DELETE FROM inventory
WHERE inventory_id NOT IN (
  SELECT DISTINCT ON (product_id) inventory_id
  FROM inventory
  ORDER BY product_id, quantity DESC, last_updated DESC, inventory_id ASC
);

-- Step 2: Add UNIQUE constraint on product_id to prevent future duplicates
ALTER TABLE inventory 
DROP CONSTRAINT IF EXISTS unique_product_id;

ALTER TABLE inventory 
ADD CONSTRAINT unique_product_id UNIQUE (product_id);

-- Step 3: Verify the fix - this should return no rows
SELECT product_id, COUNT(*) as duplicate_count
FROM inventory
GROUP BY product_id
HAVING COUNT(*) > 1;

-- Step 4: Show current inventory status
SELECT 
  i.inventory_id,
  i.product_id, 
  p.product_name,
  i.quantity,
  i.location
FROM inventory i
LEFT JOIN products p ON i.product_id = p.product_id
ORDER BY i.product_id;
