-- Add bank transfer fields to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN IF NOT EXISTS bank_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS bank_account_number VARCHAR(100),
ADD COLUMN IF NOT EXISTS bank_swift_code VARCHAR(20),
ADD COLUMN IF NOT EXISTS bank_iban VARCHAR(50),
ADD COLUMN IF NOT EXISTS bank_branch VARCHAR(255),
ADD COLUMN IF NOT EXISTS bank_holder_name VARCHAR(255);

COMMENT ON COLUMN purchase_orders.bank_name IS 'Bank name for wire transfers';
COMMENT ON COLUMN purchase_orders.bank_account_number IS 'Bank account number';
COMMENT ON COLUMN purchase_orders.bank_swift_code IS 'SWIFT/BIC code for international transfers';
COMMENT ON COLUMN purchase_orders.bank_iban IS 'International Bank Account Number';
COMMENT ON COLUMN purchase_orders.bank_branch IS 'Bank branch name/code';
COMMENT ON COLUMN purchase_orders.bank_holder_name IS 'Account holder name';
