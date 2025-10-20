-- helper function to extract workspace_id from JWT claims
create or replace function public.workspace_id()
returns uuid as $$
  select nullif(current_setting('request.jwt.claims', true)::json->>'workspace_id','')::uuid;
$$ language sql stable;
