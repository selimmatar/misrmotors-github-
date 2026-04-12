-- Fix delivery_permits status check constraint to include READY_FOR_PICKUP
ALTER TABLE delivery_permits DROP CONSTRAINT IF EXISTS delivery_permits_status_check;

ALTER TABLE delivery_permits ADD CONSTRAINT delivery_permits_status_check 
  CHECK (status IN ('DRAFT', 'PRINTED', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY', 'SUBMITTED_SIGNED', 'APPROVED', 'REJECTED'));
