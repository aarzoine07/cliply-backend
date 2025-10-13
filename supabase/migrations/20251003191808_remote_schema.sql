


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."jobs" (
    "id" bigint NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "run_after" timestamp with time zone DEFAULT "now"() NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 5 NOT NULL,
    "worker_id" "uuid",
    "last_heartbeat" timestamp with time zone,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "jobs_kind_check" CHECK (("kind" = ANY (ARRAY['TRANSCRIBE'::"text", 'HIGHLIGHT_DETECT'::"text", 'CLIP_RENDER'::"text", 'THUMBNAIL_GEN'::"text", 'PUBLISH_YOUTUBE'::"text", 'ANALYTICS_INGEST'::"text"]))),
    CONSTRAINT "jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_job"("p_worker_id" "uuid") RETURNS "public"."jobs"
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_job jobs%ROWTYPE;
BEGIN
  SELECT *
  INTO v_job
  FROM jobs
  WHERE status = 'queued' AND run_after <= now()
  ORDER BY run_after ASC, id ASC
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE jobs
  SET status = 'running',
      worker_id = p_worker_id,
      last_heartbeat = now(),
      attempts = attempts + 1,
      updated_at = now()
  WHERE id = v_job.id
  RETURNING * INTO v_job;

  RETURN v_job;
END;
$$;


ALTER FUNCTION "public"."claim_job"("p_worker_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refill_tokens"("p_user_id" "uuid", "p_route" "text", "p_capacity" integer, "p_refill_per_min" integer) RETURNS integer
    LANGUAGE "plpgsql"
    AS $$
DECLARE
  v_now timestamptz := now();
  v_row rate_limits%ROWTYPE;
  v_minutes numeric;
  v_add integer;
BEGIN
  INSERT INTO rate_limits (user_id, route, tokens, capacity, refill_per_min, last_refill)
  VALUES (p_user_id, p_route, p_capacity, p_capacity, p_refill_per_min, v_now)
  ON CONFLICT (user_id, route) DO NOTHING;

  SELECT * INTO v_row
  FROM rate_limits
  WHERE user_id = p_user_id AND route = p_route
  FOR UPDATE;

  v_minutes := EXTRACT(EPOCH FROM (v_now - v_row.last_refill)) / 60.0;
  v_add := FLOOR(v_minutes * p_refill_per_min);
  IF v_add > 0 THEN
    v_row.tokens := LEAST(v_row.capacity, v_row.tokens + v_add);
    v_row.last_refill := v_now;
  END IF;

  IF v_row.tokens > 0 THEN
    v_row.tokens := v_row.tokens - 1;
  END IF;

  UPDATE rate_limits
  SET tokens = v_row.tokens,
      last_refill = v_row.last_refill,
      capacity = p_capacity,
      refill_per_min = p_refill_per_min
  WHERE user_id = p_user_id AND route = p_route;

  RETURN v_row.tokens;
END;
$$;


ALTER FUNCTION "public"."refill_tokens"("p_user_id" "uuid", "p_route" "text", "p_capacity" integer, "p_refill_per_min" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_has_org_link"("p_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  SELECT EXISTS (
    SELECT 1
    FROM org_workspaces ow
    JOIN organizations o ON o.id = ow.org_id
    WHERE ow.workspace_id = p_workspace_id
      AND o.owner_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."user_has_org_link"("p_workspace_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clip_products" (
    "clip_id" "uuid" NOT NULL,
    "product_id" "uuid" NOT NULL
);


ALTER TABLE "public"."clip_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clips" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "title" "text" DEFAULT ''::"text" NOT NULL,
    "status" "text" DEFAULT 'proposed'::"text" NOT NULL,
    "render_path" "text",
    "duration_ms" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clips_duration_ms_check" CHECK ((("duration_ms" IS NULL) OR ("duration_ms" >= 0))),
    CONSTRAINT "clips_status_check" CHECK (("status" = ANY (ARRAY['proposed'::"text", 'approved'::"text", 'rejected'::"text", 'rendering'::"text", 'ready'::"text", 'published'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."clips" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."connected_accounts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "external_id" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."connected_accounts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."events" (
    "id" bigint NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."events" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."events_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."events_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."events_id_seq" OWNED BY "public"."events"."id";



CREATE TABLE IF NOT EXISTS "public"."idempotency" (
    "key" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "request_hash" "text",
    "response_hash" "text",
    CONSTRAINT "idempotency_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."idempotency" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."jobs_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."jobs_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."jobs_id_seq" OWNED BY "public"."jobs"."id";



CREATE TABLE IF NOT EXISTS "public"."org_workspaces" (
    "org_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL
);


ALTER TABLE "public"."org_workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."products" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "source_path" "text",
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "projects_source_type_check" CHECK (("source_type" = ANY (ARRAY['file'::"text", 'youtube'::"text"]))),
    CONSTRAINT "projects_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'processing'::"text", 'ready'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."rate_limits" (
    "user_id" "uuid" NOT NULL,
    "route" "text" NOT NULL,
    "tokens" integer DEFAULT 0 NOT NULL,
    "capacity" integer DEFAULT 60 NOT NULL,
    "refill_per_min" integer DEFAULT 60 NOT NULL,
    "last_refill" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."schedules" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "clip_id" "uuid" NOT NULL,
    "run_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'scheduled'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "schedules_status_check" CHECK (("status" = ANY (ARRAY['scheduled'::"text", 'canceled'::"text", 'executed'::"text"])))
);


ALTER TABLE "public"."schedules" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "public"."events" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."events_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."jobs" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."jobs_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."clip_products"
    ADD CONSTRAINT "clip_products_pkey" PRIMARY KEY ("clip_id", "product_id");



ALTER TABLE ONLY "public"."clips"
    ADD CONSTRAINT "clips_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connected_accounts"
    ADD CONSTRAINT "connected_accounts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."connected_accounts"
    ADD CONSTRAINT "connected_accounts_provider_external_id_key" UNIQUE ("provider", "external_id");



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."idempotency"
    ADD CONSTRAINT "idempotency_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_workspaces"
    ADD CONSTRAINT "org_workspaces_pkey" PRIMARY KEY ("org_id", "workspace_id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."rate_limits"
    ADD CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("user_id", "route");



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_ca_provider_external" ON "public"."connected_accounts" USING "btree" ("provider", "external_id");



CREATE INDEX "idx_ca_user_provider" ON "public"."connected_accounts" USING "btree" ("user_id", "provider");



CREATE INDEX "idx_ca_workspace" ON "public"."connected_accounts" USING "btree" ("workspace_id");



CREATE INDEX "idx_clip_products_clip" ON "public"."clip_products" USING "btree" ("clip_id");



CREATE INDEX "idx_clip_products_product" ON "public"."clip_products" USING "btree" ("product_id");



CREATE INDEX "idx_clips_project" ON "public"."clips" USING "btree" ("project_id");



CREATE INDEX "idx_clips_status" ON "public"."clips" USING "btree" ("status");



CREATE INDEX "idx_clips_ws" ON "public"."clips" USING "btree" ("workspace_id");



CREATE INDEX "idx_events_ws_created" ON "public"."events" USING "btree" ("workspace_id", "created_at" DESC);



CREATE INDEX "idx_jobs_kind" ON "public"."jobs" USING "btree" ("kind");



CREATE INDEX "idx_jobs_status_run_after" ON "public"."jobs" USING "btree" ("status", "run_after");



CREATE INDEX "idx_jobs_ws" ON "public"."jobs" USING "btree" ("workspace_id");



CREATE INDEX "idx_org_workspaces_org" ON "public"."org_workspaces" USING "btree" ("org_id");



CREATE INDEX "idx_org_workspaces_ws" ON "public"."org_workspaces" USING "btree" ("workspace_id");



CREATE INDEX "idx_products_ws" ON "public"."products" USING "btree" ("workspace_id");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("status");



CREATE INDEX "idx_projects_ws" ON "public"."projects" USING "btree" ("workspace_id");



CREATE INDEX "idx_schedules_run_at" ON "public"."schedules" USING "btree" ("run_at");



CREATE INDEX "idx_schedules_status" ON "public"."schedules" USING "btree" ("status");



CREATE INDEX "idx_schedules_ws" ON "public"."schedules" USING "btree" ("workspace_id");



ALTER TABLE ONLY "public"."clip_products"
    ADD CONSTRAINT "clip_products_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clip_products"
    ADD CONSTRAINT "clip_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clips"
    ADD CONSTRAINT "clips_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clips"
    ADD CONSTRAINT "clips_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."connected_accounts"
    ADD CONSTRAINT "connected_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."events"
    ADD CONSTRAINT "events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."jobs"
    ADD CONSTRAINT "jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_workspaces"
    ADD CONSTRAINT "org_workspaces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_workspaces"
    ADD CONSTRAINT "org_workspaces_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."products"
    ADD CONSTRAINT "products_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_clip_id_fkey" FOREIGN KEY ("clip_id") REFERENCES "public"."clips"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."schedules"
    ADD CONSTRAINT "schedules_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE SET NULL;



CREATE POLICY "ca_all" ON "public"."connected_accounts" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "clip_all" ON "public"."clips" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "clips"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "clips"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



ALTER TABLE "public"."clip_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clip_products_all" ON "public"."clip_products" USING ((EXISTS ( SELECT 1
   FROM ("public"."clips" "c"
     JOIN "public"."workspaces" "w" ON (("w"."id" = "c"."workspace_id")))
  WHERE (("c"."id" = "clip_products"."clip_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."clips" "c"
     JOIN "public"."workspaces" "w" ON (("w"."id" = "c"."workspace_id")))
  WHERE (("c"."id" = "clip_products"."clip_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



ALTER TABLE "public"."clips" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."connected_accounts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "events_all" ON "public"."events" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "events"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "events"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



CREATE POLICY "idem_block_delete" ON "public"."idempotency" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "idem_block_updates" ON "public"."idempotency" FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);



CREATE POLICY "idem_block_writes" ON "public"."idempotency" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "idem_select" ON "public"."idempotency" FOR SELECT USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."idempotency" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "jobs_all" ON "public"."jobs" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "jobs"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "jobs"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



CREATE POLICY "org_mod" ON "public"."organizations" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "org_select" ON "public"."organizations" FOR SELECT USING (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."org_workspaces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgws_select" ON "public"."org_workspaces" FOR SELECT USING (((EXISTS ( SELECT 1
   FROM "public"."organizations" "o"
  WHERE (("o"."id" = "org_workspaces"."org_id") AND ("o"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "org_workspaces"."workspace_id") AND ("w"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "prj_all" ON "public"."projects" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "projects"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "projects"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



ALTER TABLE "public"."products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "products_all" ON "public"."products" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "products"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "products"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."rate_limits" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "rl_all" ON "public"."rate_limits" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));



CREATE POLICY "sch_all" ON "public"."schedules" USING ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "schedules"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."workspaces" "w"
  WHERE (("w"."id" = "schedules"."workspace_id") AND (("w"."owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("w"."id"))))));



ALTER TABLE "public"."schedules" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "wp_mod" ON "public"."workspaces" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "wp_select" ON "public"."workspaces" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR "public"."user_has_org_link"("id")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";

























































































































































GRANT ALL ON TABLE "public"."jobs" TO "anon";
GRANT ALL ON TABLE "public"."jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_job"("p_worker_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_job"("p_worker_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_job"("p_worker_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."refill_tokens"("p_user_id" "uuid", "p_route" "text", "p_capacity" integer, "p_refill_per_min" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."refill_tokens"("p_user_id" "uuid", "p_route" "text", "p_capacity" integer, "p_refill_per_min" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."refill_tokens"("p_user_id" "uuid", "p_route" "text", "p_capacity" integer, "p_refill_per_min" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."user_has_org_link"("p_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_has_org_link"("p_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_has_org_link"("p_workspace_id" "uuid") TO "service_role";


















GRANT ALL ON TABLE "public"."clip_products" TO "anon";
GRANT ALL ON TABLE "public"."clip_products" TO "authenticated";
GRANT ALL ON TABLE "public"."clip_products" TO "service_role";



GRANT ALL ON TABLE "public"."clips" TO "anon";
GRANT ALL ON TABLE "public"."clips" TO "authenticated";
GRANT ALL ON TABLE "public"."clips" TO "service_role";



GRANT ALL ON TABLE "public"."connected_accounts" TO "anon";
GRANT ALL ON TABLE "public"."connected_accounts" TO "authenticated";
GRANT ALL ON TABLE "public"."connected_accounts" TO "service_role";



GRANT ALL ON TABLE "public"."events" TO "anon";
GRANT ALL ON TABLE "public"."events" TO "authenticated";
GRANT ALL ON TABLE "public"."events" TO "service_role";



GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."events_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."idempotency" TO "anon";
GRANT ALL ON TABLE "public"."idempotency" TO "authenticated";
GRANT ALL ON TABLE "public"."idempotency" TO "service_role";



GRANT ALL ON SEQUENCE "public"."jobs_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."jobs_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."jobs_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."org_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."org_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."org_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."products" TO "anon";
GRANT ALL ON TABLE "public"."products" TO "authenticated";
GRANT ALL ON TABLE "public"."products" TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



GRANT ALL ON TABLE "public"."rate_limits" TO "anon";
GRANT ALL ON TABLE "public"."rate_limits" TO "authenticated";
GRANT ALL ON TABLE "public"."rate_limits" TO "service_role";



GRANT ALL ON TABLE "public"."schedules" TO "anon";
GRANT ALL ON TABLE "public"."schedules" TO "authenticated";
GRANT ALL ON TABLE "public"."schedules" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































RESET ALL;

