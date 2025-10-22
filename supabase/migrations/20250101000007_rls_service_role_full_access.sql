-- full access for service-role key
do $$
begin
  -- schema usage is required before table grants
  execute format('grant usage on schema public to service_role;');
  execute format('grant all on all tables in schema public to service_role;');
  execute format('grant all on all sequences in schema public to service_role;');
end $$;

-- ✅ Allow service role to bypass RLS on all public tables
do $$
declare
  r record;
  polname text;
begin
  for r in
    select tablename
    from pg_tables
    where schemaname = 'public'
  loop
    -- ensure RLS is enabled so policy applies
    execute format('alter table public.%I enable row level security;', r.tablename);

    -- build the policy name we want to enforce
    polname := format('service_role_full_access_%s', r.tablename);

    -- only create if it doesn't already exist
    if not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename  = r.tablename
        and policyname = polname
    ) then
      execute format('create policy %I
        on public.%I
        for all
        to service_role
        using (true)
        with check (true);', polname, r.tablename);
    end if;
  end loop;
end $$;
