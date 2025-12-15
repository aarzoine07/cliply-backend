-- T2: RLS policies on surface tables reference public.workspaces (EXISTS subqueries),
-- so authenticated must be able to SELECT workspaces for policy evaluation.
grant select on table public.workspaces to authenticated;
