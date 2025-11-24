-- D2: Add marketing metadata fields to products table
-- Extends products with landing URL, price, features, audience, objections, brand voice, etc.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS landing_url text,
  ADD COLUMN IF NOT EXISTS price_cents integer,
  ADD COLUMN IF NOT EXISTS currency text,
  ADD COLUMN IF NOT EXISTS primary_benefit text,
  ADD COLUMN IF NOT EXISTS features jsonb,
  ADD COLUMN IF NOT EXISTS target_audience text,
  ADD COLUMN IF NOT EXISTS objections text,
  ADD COLUMN IF NOT EXISTS brand_voice text,
  ADD COLUMN IF NOT EXISTS creative_notes text;

-- Add check constraint for currency if needed (optional, for data quality)
-- We'll allow any text for now to be flexible

-- Index on price_cents for filtering/sorting (optional, but useful for product discovery)
CREATE INDEX IF NOT EXISTS idx_products_price_cents ON products(price_cents) WHERE price_cents IS NOT NULL;

