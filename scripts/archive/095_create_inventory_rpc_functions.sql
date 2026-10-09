-- Create decrement_inventory RPC function for warehouse transfers
CREATE OR REPLACE FUNCTION decrement_inventory(
  p_product_id INTEGER,
  p_warehouse_id INTEGER,
  p_quantity INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE inventory
  SET quantity = quantity - p_quantity
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record not found for product % in warehouse %', p_product_id, p_warehouse_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create increment_inventory RPC function for warehouse transfers
CREATE OR REPLACE FUNCTION increment_inventory(
  p_product_id INTEGER,
  p_warehouse_id INTEGER,
  p_quantity INTEGER
) RETURNS void AS $$
BEGIN
  UPDATE inventory
  SET quantity = quantity + p_quantity
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Inventory record not found for product % in warehouse %', p_product_id, p_warehouse_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Verify functions exist
SELECT proname FROM pg_proc WHERE proname IN ('decrement_inventory', 'increment_inventory');
