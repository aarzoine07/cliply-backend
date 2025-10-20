-- utility trigger to auto-update updated_at
create or replace function public.moddatetime()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- generic example usage (each table adds its own trigger)
