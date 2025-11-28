-- Base table for products
-- Derived from remote schema, expanded with essential constraints.
-- Later migrations (dropshipping) will extend this table significantly.

CREATE TABLE IF NOT EXISTS public.products (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url           text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.products
  ENABLE ROW LEVEL SECURITY;

-- Basic workspace index
CREATE INDEX IF NOT EXISTS idx_products_workspace
  ON public.products(workspace_id);

-- Updated_at trigger
CREATE TRIGGER trg_products_updated_at
  BEFORE UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION moddatetime('updated_at');