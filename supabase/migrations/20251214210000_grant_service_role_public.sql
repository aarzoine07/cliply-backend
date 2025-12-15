-- Ensure service_role can access public tables when using the service key (PostgREST / supabase-js).
-- RLS can still apply where enabled, but table privileges must exist.

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;

alter default privileges in schema public
  grant all privileges on tables to service_role;

alter default privileges in schema public
  grant all privileges on sequences to service_role;
