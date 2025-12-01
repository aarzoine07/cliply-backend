drop extension if exists "pg_net";

alter table "public"."jobs" alter column "next_run_at" drop default;

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.now_fn()
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE
AS $function$
  select now();
$function$
;

grant delete on table "public"."jobs" to "service_role";

grant insert on table "public"."jobs" to "service_role";

grant select on table "public"."jobs" to "service_role";

grant update on table "public"."jobs" to "service_role";


