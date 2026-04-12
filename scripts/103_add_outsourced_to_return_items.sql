-- Add is_outsourced flag to return_items table
ALTER TABLE return_items ADD COLUMN IF NOT EXISTS is_outsourced BOOLEAN DEFAULT false;
