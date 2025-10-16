-- Workspace ID helper in PUBLIC schema (safe)
CREATE OR REPLACE FUNCTION public.workspace_id()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT nullif(current_setting('request.jwt.claims.workspace_id', true), '')::uuid;
$$;
