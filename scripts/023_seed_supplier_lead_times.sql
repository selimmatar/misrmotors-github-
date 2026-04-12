-- Update existing suppliers with fictional lead times based on their location/characteristics
-- Suppliers with different lead times to simulate real-world variance

UPDATE suppliers 
SET lead_time_days = CASE 
    WHEN supplier_id % 5 = 0 THEN 21  -- International supplier (longer lead time)
    WHEN supplier_id % 5 = 1 THEN 14  -- Regional supplier
    WHEN supplier_id % 5 = 2 THEN 7   -- Local supplier (shorter lead time)
    WHEN supplier_id % 5 = 3 THEN 10  -- Medium distance
    ELSE 5                             -- Express/nearby supplier
END
WHERE lead_time_days IS NULL OR lead_time_days = 7;
