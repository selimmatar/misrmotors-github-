-- Rename tables to AR/AP
ALTER TABLE IF EXISTS customer_invoices RENAME TO accounts_receivable;
ALTER TABLE IF EXISTS supplier_invoices RENAME TO accounts_payable;

-- Add contact columns to customers
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS country VARCHAR(100);

-- Add contact columns to suppliers
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS country VARCHAR(100);

-- Migrate contact data for customers
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'customer_contacts') THEN
        UPDATE customers c
        SET 
            email = cc.email,
            phone = cc.phone,
            address = cc.address,
            city = cc.city,
            country = cc.country
        FROM customer_contacts cc
        WHERE c.customer_id = cc.customer_id;
    END IF;
END $$;

-- Migrate contact data for suppliers
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'supplier_contacts') THEN
        UPDATE suppliers s
        SET 
            email = sc.email,
            phone = sc.phone,
            address = sc.address,
            city = sc.city,
            country = sc.country
        FROM supplier_contacts sc
        WHERE s.supplier_id = sc.supplier_id;
    END IF;
END $$;

-- Drop contact tables
DROP TABLE IF EXISTS customer_contacts;
DROP TABLE IF EXISTS supplier_contacts;

-- Ensure name columns are correct (idempotent)
-- Note: customer_name and supplier_name likely already exist based on schema check, but ensuring consistency.
