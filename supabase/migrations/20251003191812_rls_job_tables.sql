CREATE OR REPLACE FUNCTION public.workspace_id() RETURNS uuid AS $$
  SELECT nullif(current_setting('request.jwt.claims.workspace_id', true), '')::uuid;
$$ LANGUAGE sql STABLE;

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY jobs_select_policy
  ON public.jobs FOR SELECT
  USING (workspace_id = public.workspace_id());

CREATE POLICY jobs_insert_policy
  ON public.jobs FOR INSERT
  WITH CHECK (workspace_id = public.workspace_id());

CREATE POLICY jobs_update_policy
  ON public.jobs FOR UPDATE
  USING (workspace_id = public.workspace_id())
  WITH CHECK (workspace_id = public.workspace_id());

ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY job_events_select_policy
  ON public.job_events FOR SELECT
  USING (workspace_id = public.workspace_id());

CREATE POLICY job_events_insert_policy
  ON public.job_events FOR INSERT
  WITH CHECK (workspace_id = public.workspace_id());

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

CREATE POLICY idempotency_keys_select_policy
  ON public.idempotency_keys FOR SELECT
  USING (workspace_id = public.workspace_id());

CREATE POLICY idempotency_keys_insert_policy
  ON public.idempotency_keys FOR INSERT
  WITH CHECK (workspace_id = public.workspace_id());
