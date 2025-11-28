-- Base table for clip_products join table
-- Linking clips to products (many-to-many)
-- Dropshipping migration later adds composite PK and created_at.

CREATE TABLE IF NOT EXISTS public.clip_products (
  clip_id     uuid NOT NULL REFERENCES public.clips(id) ON DELETE CASCADE,
  product_id  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE
);

-- Enable RLS
ALTER TABLE public.clip_products
  ENABLE ROW LEVEL SECURITY;

-- Basic index for lookup
CREATE INDEX IF NOT EXISTS idx_clip_products_clip
  ON public.clip_products(clip_id);

CREATE INDEX IF NOT EXISTS idx_clip_products_product
  ON public.clip_products(product_id);