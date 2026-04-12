-- Migration: Create GRN number generation function
-- Purpose: Generate sequential GRN numbers (GRN-2026-0001, GRN-2026-0002, etc.)
-- Zero breaking changes - additive only

-- Create sequence for GRN numbers
CREATE SEQUENCE IF NOT EXISTS grn_sequence START 1;

-- Function to get next GRN number atomically
CREATE OR REPLACE FUNCTION get_next_grn_number()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT nextval('grn_sequence') INTO next_num;
  RETURN next_num;
END;
$$;

COMMENT ON FUNCTION get_next_grn_number() IS 'Atomically generates the next GRN number for goods receipts';
