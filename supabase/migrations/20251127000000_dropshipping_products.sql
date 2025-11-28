-- D1: Dropshipping Products Foundation
-- Adds proper products table structure and clip-products linking

-- Alter existing products table to add new columns
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS product_type text NOT NULL DEFAULT 'dropshipping' CHECK (product_type IN ('dropshipping')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'archived')),
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Make name and slug required (after adding them)
-- First, set defaults for existing rows if any
UPDATE products SET name = COALESCE(name, 'Product ' || id::text) WHERE name IS NULL;
UPDATE products SET slug = COALESCE(slug, 'product-' || id::text) WHERE slug IS NULL;

-- Now make them NOT NULL
ALTER TABLE products
  ALTER COLUMN name SET NOT NULL,
  ALTER COLUMN slug SET NOT NULL;

-- Add unique constraint on (workspace_id, slug)
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_workspace_slug ON products(workspace_id, slug);

-- Add index for querying active products
CREATE INDEX IF NOT EXISTS idx_products_workspace_status ON products(workspace_id, status);

-- Add foreign key constraint if not exists (workspace_id -> workspaces)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'products_workspace_id_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_workspace_id_fkey 
      FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Update clip_products table to add created_at if missing
ALTER TABLE clip_products
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Ensure clip_products has composite primary key
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'clip_products_pkey'
  ) THEN
    ALTER TABLE clip_products
      ADD CONSTRAINT clip_products_pkey PRIMARY KEY (clip_id, product_id);
  END IF;
END $$;

-- Trigger already created in products_base.sql; skip duplicate creation
-- CREATE TRIGGER trg_products_updated_at
--   BEFORE UPDATE ON products
--   FOR EACH ROW
--   EXECUTE FUNCTION moddatetime('updated_at');

-- Drop old RLS policies if they exist (to replace with new pattern)
DROP POLICY IF EXISTS products_all ON products;
DROP POLICY IF EXISTS clip_products_all ON clip_products;

-- Enable RLS (should already be enabled, but ensure it)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE clip_products ENABLE ROW LEVEL SECURITY;

-- Service role can do everything
CREATE POLICY products_service_role_full_access
  ON products
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY clip_products_service_role_full_access
  ON clip_products
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Workspace members can read/write their workspace products
CREATE POLICY products_workspace_member_access
  ON products
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = products.workspace_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members wm
      WHERE wm.workspace_id = products.workspace_id
        AND wm.user_id = auth.uid()
    )
  );

-- Workspace members can read/write clip_products for clips in their workspace
CREATE POLICY clip_products_workspace_member_access
  ON clip_products
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM clips c
      JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
      WHERE c.id = clip_products.clip_id
        AND wm.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clips c
      JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
      WHERE c.id = clip_products.clip_id
        AND wm.user_id = auth.uid()
    )
  );

