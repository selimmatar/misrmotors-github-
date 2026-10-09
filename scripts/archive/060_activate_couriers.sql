-- Activate all inactive couriers so they appear in the UI
UPDATE couriers 
SET is_active = true, updated_at = NOW()
WHERE is_active = false;

-- Verify
SELECT courier_id, courier_name, is_active FROM couriers ORDER BY courier_id;
