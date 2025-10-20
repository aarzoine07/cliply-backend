-- full access for service-role key
do $$
begin
  execute format('grant all on all tables in schema public to service_role;');
  execute format('grant all on all sequences in schema public to service_role;');
end $$;
