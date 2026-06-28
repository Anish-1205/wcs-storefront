-- Drop existing foreign key constraints on inquiries table
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_product_id_fkey;
ALTER TABLE inquiries DROP CONSTRAINT IF EXISTS inquiries_variant_id_fkey;

-- Re-add constraints with ON DELETE SET NULL
ALTER TABLE inquiries ADD CONSTRAINT inquiries_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE inquiries ADD CONSTRAINT inquiries_variant_id_fkey FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE SET NULL;

-- Create indexes to optimize catalog search and range filters
CREATE INDEX IF NOT EXISTS idx_products_fabric_type ON products(fabric_type);
CREATE INDEX IF NOT EXISTS idx_products_base_price_min ON products(base_price_min);
CREATE INDEX IF NOT EXISTS idx_products_base_price_max ON products(base_price_max);

-- Disable public insert on whatsapp_subscribers table
DROP POLICY IF EXISTS "public insert subscribers" ON whatsapp_subscribers;
