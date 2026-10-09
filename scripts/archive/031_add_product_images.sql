-- Add product_images table to store photos for each product/SKU
-- Photos can be uploaded during goods receipt and viewed in product details

CREATE TABLE IF NOT EXISTS product_images (
  image_id SERIAL PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
  image_url TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(user_id),
  po_id INTEGER REFERENCES purchase_orders(po_id),
  po_number VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create index for faster lookups by product
CREATE INDEX IF NOT EXISTS idx_product_images_product_id ON product_images(product_id);

-- Add comment for documentation
COMMENT ON TABLE product_images IS 'Stores product photos uploaded during goods receipt';
