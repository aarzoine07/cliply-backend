ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "job_events_are_workspace_scoped" ON public.job_events;

CREATE POLICY "job_events_are_workspace_scoped"
ON public.job_events
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.jobs j
    JOIN public.workspace_members wm
      ON wm.workspace_id = j.workspace_id
    WHERE j.id = job_events.job_id
      AND wm.user_id = auth.uid()
  )
);
