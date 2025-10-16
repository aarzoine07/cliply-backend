CREATE TABLE public.idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  route text NOT NULL,
  key_hash text NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  response jsonb,
  UNIQUE (workspace_id, route, key_hash)
);

-- Index for quick lookup by workspace + route
CREATE INDEX idx_idempotency_keys_workspace_route ON public.idempotency_keys(workspace_id, route);

-- Enable RLS (policies added later)
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
