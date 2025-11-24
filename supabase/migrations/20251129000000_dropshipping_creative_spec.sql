-- D2: Add creative_spec JSONB column to products table
-- Stores product-level creative specifications (angle, audience, tone, etc.)

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS creative_spec jsonb DEFAULT '{}'::jsonb;

-- Add index for querying products with creative specs (optional, but useful)
CREATE INDEX IF NOT EXISTS idx_products_creative_spec ON products USING gin(creative_spec) WHERE creative_spec IS NOT NULL AND creative_spec != '{}'::jsonb;

