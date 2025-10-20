create sequence "public"."events_id_seq";

create sequence "public"."jobs_id_seq";

drop trigger if exists "trg_jobs_updated_at" on "public"."jobs";

drop policy "idempotency_insert_same_workspace" on "public"."idempotency_keys";

drop policy "idempotency_select_same_workspace" on "public"."idempotency_keys";

drop policy "jobs_delete_same_workspace" on "public"."jobs";

drop policy "jobs_insert_same_workspace" on "public"."jobs";

drop policy "jobs_select_same_workspace" on "public"."jobs";

drop policy "jobs_update_same_workspace" on "public"."jobs";

drop policy "workspace_members_self" on "public"."workspace_members";

drop policy "workspaces_member_select" on "public"."workspaces";

revoke delete on table "public"."idempotency_keys" from "anon";

revoke insert on table "public"."idempotency_keys" from "anon";

revoke references on table "public"."idempotency_keys" from "anon";

revoke select on table "public"."idempotency_keys" from "anon";

revoke trigger on table "public"."idempotency_keys" from "anon";

revoke truncate on table "public"."idempotency_keys" from "anon";

revoke update on table "public"."idempotency_keys" from "anon";

revoke delete on table "public"."idempotency_keys" from "authenticated";

revoke insert on table "public"."idempotency_keys" from "authenticated";

revoke references on table "public"."idempotency_keys" from "authenticated";

revoke select on table "public"."idempotency_keys" from "authenticated";

revoke trigger on table "public"."idempotency_keys" from "authenticated";

revoke truncate on table "public"."idempotency_keys" from "authenticated";

revoke update on table "public"."idempotency_keys" from "authenticated";

revoke delete on table "public"."idempotency_keys" from "service_role";

revoke insert on table "public"."idempotency_keys" from "service_role";

revoke references on table "public"."idempotency_keys" from "service_role";

revoke select on table "public"."idempotency_keys" from "service_role";

revoke trigger on table "public"."idempotency_keys" from "service_role";

revoke truncate on table "public"."idempotency_keys" from "service_role";

revoke update on table "public"."idempotency_keys" from "service_role";

revoke delete on table "public"."job_events" from "anon";

revoke insert on table "public"."job_events" from "anon";

revoke references on table "public"."job_events" from "anon";

revoke select on table "public"."job_events" from "anon";

revoke trigger on table "public"."job_events" from "anon";

revoke truncate on table "public"."job_events" from "anon";

revoke update on table "public"."job_events" from "anon";

revoke delete on table "public"."job_events" from "authenticated";

revoke insert on table "public"."job_events" from "authenticated";

revoke references on table "public"."job_events" from "authenticated";

revoke select on table "public"."job_events" from "authenticated";

revoke trigger on table "public"."job_events" from "authenticated";

revoke truncate on table "public"."job_events" from "authenticated";

revoke update on table "public"."job_events" from "authenticated";

revoke delete on table "public"."job_events" from "service_role";

revoke insert on table "public"."job_events" from "service_role";

revoke references on table "public"."job_events" from "service_role";

revoke select on table "public"."job_events" from "service_role";

revoke trigger on table "public"."job_events" from "service_role";

revoke truncate on table "public"."job_events" from "service_role";

revoke update on table "public"."job_events" from "service_role";

revoke delete on table "public"."jobs" from "anon";

revoke insert on table "public"."jobs" from "anon";

revoke references on table "public"."jobs" from "anon";

revoke select on table "public"."jobs" from "anon";

revoke trigger on table "public"."jobs" from "anon";

revoke truncate on table "public"."jobs" from "anon";

revoke update on table "public"."jobs" from "anon";

revoke delete on table "public"."jobs" from "authenticated";

revoke insert on table "public"."jobs" from "authenticated";

revoke references on table "public"."jobs" from "authenticated";

revoke select on table "public"."jobs" from "authenticated";

revoke trigger on table "public"."jobs" from "authenticated";

revoke truncate on table "public"."jobs" from "authenticated";

revoke update on table "public"."jobs" from "authenticated";

revoke delete on table "public"."jobs" from "service_role";

revoke insert on table "public"."jobs" from "service_role";

revoke references on table "public"."jobs" from "service_role";

revoke select on table "public"."jobs" from "service_role";

revoke trigger on table "public"."jobs" from "service_role";

revoke truncate on table "public"."jobs" from "service_role";

revoke update on table "public"."jobs" from "service_role";

revoke delete on table "public"."workspace_members" from "anon";

revoke insert on table "public"."workspace_members" from "anon";

revoke references on table "public"."workspace_members" from "anon";

revoke select on table "public"."workspace_members" from "anon";

revoke trigger on table "public"."workspace_members" from "anon";

revoke truncate on table "public"."workspace_members" from "anon";

revoke update on table "public"."workspace_members" from "anon";

revoke delete on table "public"."workspace_members" from "authenticated";

revoke insert on table "public"."workspace_members" from "authenticated";

revoke references on table "public"."workspace_members" from "authenticated";

revoke select on table "public"."workspace_members" from "authenticated";

revoke trigger on table "public"."workspace_members" from "authenticated";

revoke truncate on table "public"."workspace_members" from "authenticated";

revoke update on table "public"."workspace_members" from "authenticated";

revoke delete on table "public"."workspace_members" from "service_role";

revoke insert on table "public"."workspace_members" from "service_role";

revoke references on table "public"."workspace_members" from "service_role";

revoke select on table "public"."workspace_members" from "service_role";

revoke trigger on table "public"."workspace_members" from "service_role";

revoke truncate on table "public"."workspace_members" from "service_role";

revoke update on table "public"."workspace_members" from "service_role";

revoke delete on table "public"."workspaces" from "anon";

revoke insert on table "public"."workspaces" from "anon";

revoke references on table "public"."workspaces" from "anon";

revoke select on table "public"."workspaces" from "anon";

revoke trigger on table "public"."workspaces" from "anon";

revoke truncate on table "public"."workspaces" from "anon";

revoke update on table "public"."workspaces" from "anon";

revoke delete on table "public"."workspaces" from "authenticated";

revoke insert on table "public"."workspaces" from "authenticated";

revoke references on table "public"."workspaces" from "authenticated";

revoke select on table "public"."workspaces" from "authenticated";

revoke trigger on table "public"."workspaces" from "authenticated";

revoke truncate on table "public"."workspaces" from "authenticated";

revoke update on table "public"."workspaces" from "authenticated";

revoke delete on table "public"."workspaces" from "service_role";

revoke insert on table "public"."workspaces" from "service_role";

revoke references on table "public"."workspaces" from "service_role";

revoke select on table "public"."workspaces" from "service_role";

revoke trigger on table "public"."workspaces" from "service_role";

revoke truncate on table "public"."workspaces" from "service_role";

revoke update on table "public"."workspaces" from "service_role";

alter table "public"."idempotency_keys" drop constraint "idempotency_keys_workspace_id_route_key_hash_key";

alter table "public"."idempotency_keys" drop constraint "idempotency_keys_workspace_route_keyhash_unique";

alter table "public"."job_events" drop constraint "job_events_job_id_fkey";

alter table "public"."jobs" drop constraint "jobs_priority_check";

alter table "public"."jobs" drop constraint "jobs_state_check";

alter table "public"."jobs" drop constraint "jobs_kind_check";

drop function if exists "public"."worker_claim_next_job"(p_worker_id text);

alter table "public"."idempotency_keys" drop constraint "idempotency_keys_pkey";

alter table "public"."job_events" drop constraint "job_events_pkey";

drop index if exists "public"."idempotency_keys_pkey";

drop index if exists "public"."idempotency_keys_workspace_id_route_key_hash_key";

drop index if exists "public"."idempotency_keys_workspace_route_keyhash_unique";

drop index if exists "public"."job_events_pkey";

drop table "public"."idempotency_keys";

drop table "public"."job_events";

create table "public"."clip_products" (
    "clip_id" uuid not null,
    "product_id" uuid not null
);


alter table "public"."clip_products" enable row level security;

create table "public"."clips" (
    "id" uuid not null default gen_random_uuid(),
    "project_id" uuid not null,
    "workspace_id" uuid not null,
    "title" text not null default ''::text,
    "status" text not null default 'proposed'::text,
    "render_path" text,
    "duration_ms" integer,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);


alter table "public"."clips" enable row level security;

create table "public"."connected_accounts" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "workspace_id" uuid not null,
    "provider" text not null,
    "external_id" text not null,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone,
    "platform" text not null,
    "access_token_encrypted_ref" text,
    "refresh_token_encrypted_ref" text,
    "scopes" text[]
);


alter table "public"."connected_accounts" enable row level security;

create table "public"."dmca_reports" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "reporter_id" uuid,
    "clip_id" uuid,
    "reason" text,
    "status" text not null default 'pending'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);


alter table "public"."dmca_reports" enable row level security;

create table "public"."events" (
    "id" bigint not null default nextval('events_id_seq'::regclass),
    "workspace_id" uuid not null,
    "name" text not null,
    "data" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now()
);


alter table "public"."events" enable row level security;

create table "public"."events_audit" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "actor_id" uuid,
    "event_type" text not null,
    "target_id" uuid,
    "payload" jsonb not null default '{}'::jsonb,
    "created_at" timestamp with time zone not null default now()
);


alter table "public"."events_audit" enable row level security;

create table "public"."idempotency" (
    "key" text not null,
    "user_id" uuid not null,
    "status" text not null,
    "created_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone,
    "request_hash" text,
    "response_hash" text
);


alter table "public"."idempotency" enable row level security;

create table "public"."org_workspaces" (
    "org_id" uuid not null,
    "workspace_id" uuid not null
);


alter table "public"."org_workspaces" enable row level security;

create table "public"."organizations" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "owner_id" uuid not null,
    "created_at" timestamp with time zone not null default now()
);


alter table "public"."organizations" enable row level security;

create table "public"."products" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "url" text not null,
    "created_at" timestamp with time zone not null default now()
);


alter table "public"."products" enable row level security;

create table "public"."projects" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "title" text not null,
    "source_type" text not null,
    "source_path" text,
    "status" text not null default 'queued'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);


alter table "public"."projects" enable row level security;

create table "public"."rate_limits" (
    "user_id" uuid not null,
    "route" text not null,
    "tokens" integer not null default 0,
    "capacity" integer not null default 60,
    "refill_per_min" integer not null default 60,
    "last_refill" timestamp with time zone not null default now(),
    "workspace_id" uuid
);


alter table "public"."rate_limits" enable row level security;

create table "public"."schedules" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "clip_id" uuid not null,
    "run_at" timestamp with time zone not null,
    "status" text not null default 'scheduled'::text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);


alter table "public"."schedules" enable row level security;

create table "public"."subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "workspace_id" uuid not null,
    "stripe_customer_id" text not null,
    "stripe_subscription_id" text not null,
    "plan_name" text not null,
    "price_id" text not null,
    "status" text not null,
    "current_period_start" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "cancel_at_period_end" boolean not null default false,
    "trial_end" timestamp with time zone,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now()
);


alter table "public"."subscriptions" enable row level security;

create table "public"."users" (
    "id" uuid not null default gen_random_uuid(),
    "email" text not null,
    "full_name" text,
    "avatar_url" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "default_workspace_id" uuid
);


alter table "public"."users" enable row level security;

alter table "public"."jobs" drop column "heartbeat_at";

alter table "public"."jobs" drop column "last_error";

alter table "public"."jobs" drop column "locked_at";

alter table "public"."jobs" drop column "locked_by";

alter table "public"."jobs" drop column "priority";

alter table "public"."jobs" drop column "result";

alter table "public"."jobs" drop column "run_at";

alter table "public"."jobs" drop column "state";

alter table "public"."jobs" add column "error" jsonb;

alter table "public"."jobs" add column "last_heartbeat" timestamp with time zone;

alter table "public"."jobs" add column "run_after" timestamp with time zone not null default now();

alter table "public"."jobs" add column "status" text not null default 'queued'::text;

alter table "public"."jobs" add column "worker_id" uuid;

alter table "public"."jobs" alter column "attempts" set not null;

alter table "public"."jobs" alter column "created_at" set not null;

alter table "public"."jobs" alter column "id" set default nextval('jobs_id_seq'::regclass);

alter table "public"."jobs" alter column "id" set data type bigint using "id"::bigint;

alter table "public"."jobs" alter column "max_attempts" set not null;

alter table "public"."jobs" alter column "payload" set not null;

alter table "public"."jobs" alter column "updated_at" set not null;

alter table "public"."workspace_members" drop column "inserted_at";

alter table "public"."workspace_members" add column "created_at" timestamp with time zone not null default now();

alter table "public"."workspace_members" alter column "role" set not null;

alter table "public"."workspace_members" alter column "workspace_id" set not null;

alter table "public"."workspaces" add column "org_id" uuid;

alter table "public"."workspaces" add column "owner_id" uuid not null;

alter table "public"."workspaces" alter column "created_at" set not null;

alter sequence "public"."events_id_seq" owned by "public"."events"."id";

alter sequence "public"."jobs_id_seq" owned by "public"."jobs"."id";

drop sequence if exists "public"."idempotency_keys_id_seq";

drop sequence if exists "public"."job_events_id_seq";

CREATE UNIQUE INDEX clip_products_pkey ON public.clip_products USING btree (clip_id, product_id);

CREATE UNIQUE INDEX clips_pkey ON public.clips USING btree (id);

CREATE INDEX connected_accounts_expires_idx ON public.connected_accounts USING btree (expires_at);

CREATE UNIQUE INDEX connected_accounts_pkey ON public.connected_accounts USING btree (id);

CREATE UNIQUE INDEX connected_accounts_provider_external_id_key ON public.connected_accounts USING btree (provider, external_id);

CREATE UNIQUE INDEX connected_accounts_workspace_platform_key ON public.connected_accounts USING btree (workspace_id, platform);

CREATE UNIQUE INDEX dmca_reports_pkey ON public.dmca_reports USING btree (id);

CREATE UNIQUE INDEX events_audit_pkey ON public.events_audit USING btree (id);

CREATE UNIQUE INDEX events_pkey ON public.events USING btree (id);

CREATE UNIQUE INDEX idempotency_pkey ON public.idempotency USING btree (key);

CREATE INDEX idx_ca_provider_external ON public.connected_accounts USING btree (provider, external_id);

CREATE INDEX idx_ca_user_provider ON public.connected_accounts USING btree (user_id, provider);

CREATE INDEX idx_ca_workspace ON public.connected_accounts USING btree (workspace_id);

CREATE INDEX idx_clip_products_clip ON public.clip_products USING btree (clip_id);

CREATE INDEX idx_clip_products_product ON public.clip_products USING btree (product_id);

CREATE INDEX idx_clips_project ON public.clips USING btree (project_id);

CREATE INDEX idx_clips_status ON public.clips USING btree (status);

CREATE INDEX idx_clips_ws ON public.clips USING btree (workspace_id);

CREATE INDEX idx_connected_accounts_expires_at ON public.connected_accounts USING btree (expires_at);

CREATE INDEX idx_connected_accounts_workspace_id ON public.connected_accounts USING btree (workspace_id);

CREATE INDEX idx_dmca_reports_status ON public.dmca_reports USING btree (status);

CREATE INDEX idx_dmca_reports_workspace_id ON public.dmca_reports USING btree (workspace_id);

CREATE INDEX idx_events_audit_created_at_desc ON public.events_audit USING btree (created_at DESC);

CREATE INDEX idx_events_audit_event_type ON public.events_audit USING btree (event_type);

CREATE INDEX idx_events_audit_workspace_id ON public.events_audit USING btree (workspace_id);

CREATE INDEX idx_events_ws_created ON public.events USING btree (workspace_id, created_at DESC);

CREATE INDEX idx_jobs_kind ON public.jobs USING btree (kind);

CREATE INDEX idx_jobs_status_run_after ON public.jobs USING btree (status, run_after);

CREATE INDEX idx_jobs_ws ON public.jobs USING btree (workspace_id);

CREATE INDEX idx_org_workspaces_org ON public.org_workspaces USING btree (org_id);

CREATE INDEX idx_org_workspaces_ws ON public.org_workspaces USING btree (workspace_id);

CREATE INDEX idx_products_ws ON public.products USING btree (workspace_id);

CREATE INDEX idx_projects_status ON public.projects USING btree (status);

CREATE INDEX idx_projects_ws ON public.projects USING btree (workspace_id);

CREATE INDEX idx_rate_limits_workspace_id ON public.rate_limits USING btree (workspace_id);

CREATE INDEX idx_schedules_run_at ON public.schedules USING btree (run_at);

CREATE INDEX idx_schedules_status ON public.schedules USING btree (status);

CREATE INDEX idx_schedules_ws ON public.schedules USING btree (workspace_id);

CREATE INDEX idx_subscriptions_status ON public.subscriptions USING btree (status);

CREATE INDEX idx_subscriptions_workspace_id ON public.subscriptions USING btree (workspace_id);

CREATE INDEX idx_users_default_workspace_id ON public.users USING btree (default_workspace_id);

CREATE INDEX idx_users_email ON public.users USING btree (email);

CREATE INDEX idx_workspace_members_user_id ON public.workspace_members USING btree (user_id);

CREATE INDEX idx_workspace_members_workspace_user ON public.workspace_members USING btree (workspace_id, user_id);

CREATE INDEX idx_workspaces_owner_id ON public.workspaces USING btree (owner_id);

CREATE UNIQUE INDEX org_workspaces_pkey ON public.org_workspaces USING btree (org_id, workspace_id);

CREATE UNIQUE INDEX organizations_pkey ON public.organizations USING btree (id);

CREATE UNIQUE INDEX products_pkey ON public.products USING btree (id);

CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id);

CREATE UNIQUE INDEX rate_limits_pkey ON public.rate_limits USING btree (user_id, route);

CREATE UNIQUE INDEX schedules_pkey ON public.schedules USING btree (id);

CREATE UNIQUE INDEX subscriptions_pkey ON public.subscriptions USING btree (id);

CREATE UNIQUE INDEX subscriptions_stripe_customer_id_key ON public.subscriptions USING btree (stripe_customer_id);

CREATE UNIQUE INDEX subscriptions_stripe_subscription_id_key ON public.subscriptions USING btree (stripe_subscription_id);

CREATE UNIQUE INDEX subscriptions_workspace_subscription_unique ON public.subscriptions USING btree (workspace_id, stripe_subscription_id);

CREATE UNIQUE INDEX users_email_key ON public.users USING btree (email);

CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id);

CREATE UNIQUE INDEX workspace_members_workspace_user_unique ON public.workspace_members USING btree (workspace_id, user_id);

alter table "public"."clip_products" add constraint "clip_products_pkey" PRIMARY KEY using index "clip_products_pkey";

alter table "public"."clips" add constraint "clips_pkey" PRIMARY KEY using index "clips_pkey";

alter table "public"."connected_accounts" add constraint "connected_accounts_pkey" PRIMARY KEY using index "connected_accounts_pkey";

alter table "public"."dmca_reports" add constraint "dmca_reports_pkey" PRIMARY KEY using index "dmca_reports_pkey";

alter table "public"."events" add constraint "events_pkey" PRIMARY KEY using index "events_pkey";

alter table "public"."events_audit" add constraint "events_audit_pkey" PRIMARY KEY using index "events_audit_pkey";

alter table "public"."idempotency" add constraint "idempotency_pkey" PRIMARY KEY using index "idempotency_pkey";

alter table "public"."org_workspaces" add constraint "org_workspaces_pkey" PRIMARY KEY using index "org_workspaces_pkey";

alter table "public"."organizations" add constraint "organizations_pkey" PRIMARY KEY using index "organizations_pkey";

alter table "public"."products" add constraint "products_pkey" PRIMARY KEY using index "products_pkey";

alter table "public"."projects" add constraint "projects_pkey" PRIMARY KEY using index "projects_pkey";

alter table "public"."rate_limits" add constraint "rate_limits_pkey" PRIMARY KEY using index "rate_limits_pkey";

alter table "public"."schedules" add constraint "schedules_pkey" PRIMARY KEY using index "schedules_pkey";

alter table "public"."subscriptions" add constraint "subscriptions_pkey" PRIMARY KEY using index "subscriptions_pkey";

alter table "public"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "public"."clip_products" add constraint "clip_products_clip_id_fkey" FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE not valid;

alter table "public"."clip_products" validate constraint "clip_products_clip_id_fkey";

alter table "public"."clip_products" add constraint "clip_products_product_id_fkey" FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE not valid;

alter table "public"."clip_products" validate constraint "clip_products_product_id_fkey";

alter table "public"."clips" add constraint "clips_duration_ms_check" CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))) not valid;

alter table "public"."clips" validate constraint "clips_duration_ms_check";

alter table "public"."clips" add constraint "clips_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE not valid;

alter table "public"."clips" validate constraint "clips_project_id_fkey";

alter table "public"."clips" add constraint "clips_status_check" CHECK ((status = ANY (ARRAY['proposed'::text, 'approved'::text, 'rejected'::text, 'rendering'::text, 'ready'::text, 'published'::text, 'failed'::text]))) not valid;

alter table "public"."clips" validate constraint "clips_status_check";

alter table "public"."clips" add constraint "clips_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."clips" validate constraint "clips_workspace_id_fkey";

alter table "public"."connected_accounts" add constraint "connected_accounts_platform_check" CHECK ((platform = 'tiktok'::text)) not valid;

alter table "public"."connected_accounts" validate constraint "connected_accounts_platform_check";

alter table "public"."connected_accounts" add constraint "connected_accounts_provider_external_id_key" UNIQUE using index "connected_accounts_provider_external_id_key";

alter table "public"."connected_accounts" add constraint "connected_accounts_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."connected_accounts" validate constraint "connected_accounts_workspace_id_fkey";

alter table "public"."dmca_reports" add constraint "dmca_reports_reporter_id_fkey" FOREIGN KEY (reporter_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."dmca_reports" validate constraint "dmca_reports_reporter_id_fkey";

alter table "public"."dmca_reports" add constraint "dmca_reports_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'reviewed'::text, 'rejected'::text, 'resolved'::text]))) not valid;

alter table "public"."dmca_reports" validate constraint "dmca_reports_status_check";

alter table "public"."dmca_reports" add constraint "dmca_reports_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."dmca_reports" validate constraint "dmca_reports_workspace_id_fkey";

alter table "public"."events" add constraint "events_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."events" validate constraint "events_workspace_id_fkey";

alter table "public"."events_audit" add constraint "events_audit_actor_id_fkey" FOREIGN KEY (actor_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."events_audit" validate constraint "events_audit_actor_id_fkey";

alter table "public"."events_audit" add constraint "events_audit_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."events_audit" validate constraint "events_audit_workspace_id_fkey";

alter table "public"."idempotency" add constraint "idempotency_status_check" CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'failed'::text]))) not valid;

alter table "public"."idempotency" validate constraint "idempotency_status_check";

alter table "public"."jobs" add constraint "jobs_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text]))) not valid;

alter table "public"."jobs" validate constraint "jobs_status_check";

alter table "public"."jobs" add constraint "jobs_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."jobs" validate constraint "jobs_workspace_id_fkey";

alter table "public"."org_workspaces" add constraint "org_workspaces_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE not valid;

alter table "public"."org_workspaces" validate constraint "org_workspaces_org_id_fkey";

alter table "public"."org_workspaces" add constraint "org_workspaces_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."org_workspaces" validate constraint "org_workspaces_workspace_id_fkey";

alter table "public"."products" add constraint "products_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."products" validate constraint "products_workspace_id_fkey";

alter table "public"."projects" add constraint "projects_source_type_check" CHECK ((source_type = ANY (ARRAY['file'::text, 'youtube'::text]))) not valid;

alter table "public"."projects" validate constraint "projects_source_type_check";

alter table "public"."projects" add constraint "projects_status_check" CHECK ((status = ANY (ARRAY['queued'::text, 'processing'::text, 'ready'::text, 'error'::text]))) not valid;

alter table "public"."projects" validate constraint "projects_status_check";

alter table "public"."projects" add constraint "projects_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."projects" validate constraint "projects_workspace_id_fkey";

alter table "public"."schedules" add constraint "schedules_clip_id_fkey" FOREIGN KEY (clip_id) REFERENCES clips(id) ON DELETE CASCADE not valid;

alter table "public"."schedules" validate constraint "schedules_clip_id_fkey";

alter table "public"."schedules" add constraint "schedules_status_check" CHECK ((status = ANY (ARRAY['scheduled'::text, 'canceled'::text, 'executed'::text]))) not valid;

alter table "public"."schedules" validate constraint "schedules_status_check";

alter table "public"."schedules" add constraint "schedules_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."schedules" validate constraint "schedules_workspace_id_fkey";

alter table "public"."subscriptions" add constraint "subscriptions_plan_name_check" CHECK ((plan_name = ANY (ARRAY['basic'::text, 'growth'::text, 'agency'::text]))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_plan_name_check";

alter table "public"."subscriptions" add constraint "subscriptions_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'canceled'::text, 'incomplete'::text, 'past_due'::text]))) not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_status_check";

alter table "public"."subscriptions" add constraint "subscriptions_stripe_customer_id_key" UNIQUE using index "subscriptions_stripe_customer_id_key";

alter table "public"."subscriptions" add constraint "subscriptions_stripe_subscription_id_key" UNIQUE using index "subscriptions_stripe_subscription_id_key";

alter table "public"."subscriptions" add constraint "subscriptions_workspace_id_fkey" FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE not valid;

alter table "public"."subscriptions" validate constraint "subscriptions_workspace_id_fkey";

alter table "public"."subscriptions" add constraint "subscriptions_workspace_subscription_unique" UNIQUE using index "subscriptions_workspace_subscription_unique";

alter table "public"."users" add constraint "users_default_workspace_id_fkey" FOREIGN KEY (default_workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL not valid;

alter table "public"."users" validate constraint "users_default_workspace_id_fkey";

alter table "public"."users" add constraint "users_email_key" UNIQUE using index "users_email_key";

alter table "public"."workspace_members" add constraint "workspace_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'member'::text]))) not valid;

alter table "public"."workspace_members" validate constraint "workspace_members_role_check";

alter table "public"."workspace_members" add constraint "workspace_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."workspace_members" validate constraint "workspace_members_user_id_fkey";

alter table "public"."workspace_members" add constraint "workspace_members_workspace_user_unique" UNIQUE using index "workspace_members_workspace_user_unique";

alter table "public"."workspaces" add constraint "workspaces_org_id_fkey" FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL not valid;

alter table "public"."workspaces" validate constraint "workspaces_org_id_fkey";

alter table "public"."jobs" add constraint "jobs_kind_check" CHECK ((kind = ANY (ARRAY['TRANSCRIBE'::text, 'HIGHLIGHT_DETECT'::text, 'CLIP_RENDER'::text, 'THUMBNAIL_GEN'::text, 'PUBLISH_YOUTUBE'::text, 'ANALYTICS_INGEST'::text]))) not valid;

alter table "public"."jobs" validate constraint "jobs_kind_check";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.claim_job(p_worker_id uuid)
 RETURNS jobs
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.fn_consume_token(p_workspace_id uuid, p_feature text)
 RETURNS boolean
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tokens integer;
  v_now timestamptz := now();
BEGIN
  PERFORM public.fn_refill_tokens(p_workspace_id, p_feature);

  SELECT tokens
  INTO v_tokens
  FROM public.rate_limits
  WHERE workspace_id = p_workspace_id
    AND feature = p_feature
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  IF v_tokens > 0 THEN
    UPDATE public.rate_limits
    SET tokens = v_tokens - 1,
        updated_at = v_now
    WHERE workspace_id = p_workspace_id
      AND feature = p_feature;
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.fn_refill_tokens(p_workspace_id uuid, p_feature text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_now timestamptz := now();
  v_rate integer;
  v_capacity integer;
  v_tokens integer;
  v_last_refill timestamptz;
  v_elapsed_seconds numeric;
  v_refill_amount integer;
BEGIN
  SELECT refill_rate, capacity, tokens, last_refill_at
  INTO v_rate, v_capacity, v_tokens, v_last_refill
  FROM public.rate_limits
  WHERE workspace_id = p_workspace_id
    AND feature = p_feature
  FOR UPDATE;

  IF NOT FOUND THEN
    -- No existing bucket; create default zero-capacity row for future updates.
    INSERT INTO public.rate_limits (workspace_id, feature)
    VALUES (p_workspace_id, p_feature)
    ON CONFLICT (workspace_id, feature) DO NOTHING;
    RETURN;
  END IF;

  v_elapsed_seconds := EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_refill, v_now)));
  IF v_rate > 0 AND v_elapsed_seconds > 0 THEN
    v_refill_amount := FLOOR((v_elapsed_seconds / 3600) * v_rate);
    IF v_refill_amount > 0 THEN
      v_tokens := LEAST(v_capacity, v_tokens + v_refill_amount);
      v_last_refill := v_now;
    END IF;
  END IF;

  UPDATE public.rate_limits
  SET tokens = v_tokens,
      last_refill_at = v_last_refill,
      updated_at = v_now
  WHERE workspace_id = p_workspace_id
    AND feature = p_feature;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.jwt_encode(uid uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare
  token text;
begin
  select
    sign(
      payload := json_build_object(
        'sub', uid::text,
        'role', 'authenticated',
        'email', uid::text || '@cliply.test'
      ),
      secret := current_setting('app.jwt_secret')
    )
  into token;

  return token;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.refill_tokens(p_user_id uuid, p_route text, p_capacity integer, p_refill_per_min integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_connected_accounts_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.user_has_org_link(p_workspace_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM org_workspaces ow
    JOIN organizations o ON o.id = ow.org_id
    WHERE ow.workspace_id = p_workspace_id
      AND o.owner_id = auth.uid()
  );
$function$
;

CREATE OR REPLACE FUNCTION public.moddatetime()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.workspace_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE
AS $function$
  SELECT nullif(current_setting('request.jwt.claims.workspace_id', true), '')::uuid;
$function$
;

create policy "clip_products_all"
on "public"."clip_products"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM (clips c
     JOIN workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((c.id = clip_products.clip_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM (clips c
     JOIN workspaces w ON ((w.id = c.workspace_id)))
  WHERE ((c.id = clip_products.clip_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "clip_all"
on "public"."clips"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = clips.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = clips.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "ca_all"
on "public"."connected_accounts"
as permissive
for all
to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));


create policy "connected_accounts_service_role_full_access"
on "public"."connected_accounts"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "connected_accounts_workspace_member_read"
on "public"."connected_accounts"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = connected_accounts.workspace_id) AND (wm.user_id = auth.uid()))))));


create policy "service_role_full_access"
on "public"."connected_accounts"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "workspace_member_read"
on "public"."connected_accounts"
as permissive
for select
to public
using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = connected_accounts.workspace_id) AND (wm.user_id = auth.uid())))));


create policy "dmca_reports_member_insert"
on "public"."dmca_reports"
as permissive
for insert
to public
with check (((auth.uid() IS NOT NULL) AND (reporter_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = dmca_reports.workspace_id) AND (wm.user_id = auth.uid()))))));


create policy "dmca_reports_service_role_full_access"
on "public"."dmca_reports"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "dmca_reports_service_update"
on "public"."dmca_reports"
as permissive
for update
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "dmca_reports_workspace_member_read"
on "public"."dmca_reports"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = dmca_reports.workspace_id) AND (wm.user_id = auth.uid()))))));


create policy "events_all"
on "public"."events"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = events.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = events.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "events_audit_service_insert"
on "public"."events_audit"
as permissive
for insert
to public
with check ((auth.role() = 'service_role'::text));


create policy "events_audit_service_role_full_access"
on "public"."events_audit"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "events_audit_workspace_member_read"
on "public"."events_audit"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = events_audit.workspace_id) AND (wm.user_id = auth.uid()))))));


create policy "idem_block_delete"
on "public"."idempotency"
as permissive
for delete
to authenticated
using (false);


create policy "idem_block_updates"
on "public"."idempotency"
as permissive
for update
to authenticated
using (false)
with check (false);


create policy "idem_block_writes"
on "public"."idempotency"
as permissive
for insert
to authenticated
with check (false);


create policy "idem_select"
on "public"."idempotency"
as permissive
for select
to public
using ((user_id = auth.uid()));


create policy "jobs_all"
on "public"."jobs"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = jobs.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = jobs.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "orgws_select"
on "public"."org_workspaces"
as permissive
for select
to public
using (((EXISTS ( SELECT 1
   FROM organizations o
  WHERE ((o.id = org_workspaces.org_id) AND (o.owner_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = org_workspaces.workspace_id) AND (w.owner_id = auth.uid()))))));


create policy "org_mod"
on "public"."organizations"
as permissive
for all
to public
using ((owner_id = auth.uid()))
with check ((owner_id = auth.uid()));


create policy "org_select"
on "public"."organizations"
as permissive
for select
to public
using ((owner_id = auth.uid()));


create policy "products_all"
on "public"."products"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = products.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = products.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "prj_all"
on "public"."projects"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = projects.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = projects.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "rate_limits_service_role_full_access"
on "public"."rate_limits"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "rate_limits_workspace_member_read"
on "public"."rate_limits"
as permissive
for select
to public
using ((EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = rate_limits.workspace_id) AND (wm.user_id = auth.uid())))));


create policy "rl_all"
on "public"."rate_limits"
as permissive
for all
to public
using ((user_id = auth.uid()))
with check ((user_id = auth.uid()));


create policy "sch_all"
on "public"."schedules"
as permissive
for all
to public
using ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = schedules.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))))
with check ((EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = schedules.workspace_id) AND ((w.owner_id = auth.uid()) OR user_has_org_link(w.id))))));


create policy "subscriptions_service_insert"
on "public"."subscriptions"
as permissive
for insert
to public
with check ((auth.role() = 'service_role'::text));


create policy "subscriptions_service_role_full_access"
on "public"."subscriptions"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "subscriptions_service_update"
on "public"."subscriptions"
as permissive
for update
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "subscriptions_workspace_member_read"
on "public"."subscriptions"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspace_members wm
  WHERE ((wm.workspace_id = subscriptions.workspace_id) AND (wm.user_id = auth.uid()))))));


create policy "users_self_delete"
on "public"."users"
as permissive
for delete
to public
using (((auth.uid() IS NOT NULL) AND (auth.uid() = id)));


create policy "users_self_insert"
on "public"."users"
as permissive
for insert
to public
with check (((auth.uid() IS NOT NULL) AND (auth.uid() = id)));


create policy "users_self_select"
on "public"."users"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (auth.uid() = id)));


create policy "users_self_update"
on "public"."users"
as permissive
for update
to public
using (((auth.uid() IS NOT NULL) AND (auth.uid() = id)))
with check (((auth.uid() IS NOT NULL) AND (auth.uid() = id)));


create policy "users_service_role_full_access"
on "public"."users"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "workspace_members_member_read"
on "public"."workspace_members"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspace_members wm_self
  WHERE ((wm_self.workspace_id = workspace_members.workspace_id) AND (wm_self.user_id = auth.uid()))))));


create policy "workspace_members_owner_delete"
on "public"."workspace_members"
as permissive
for delete
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid()))))));


create policy "workspace_members_owner_insert"
on "public"."workspace_members"
as permissive
for insert
to public
with check (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid()))))));


create policy "workspace_members_owner_update"
on "public"."workspace_members"
as permissive
for update
to public
using (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid()))))))
with check (((auth.uid() IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM workspaces w
  WHERE ((w.id = workspace_members.workspace_id) AND (w.owner_id = auth.uid()))))));


create policy "workspace_members_service_role_full_access"
on "public"."workspace_members"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "workspaces_owner_delete"
on "public"."workspaces"
as permissive
for delete
to public
using (((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id)));


create policy "workspaces_owner_insert"
on "public"."workspaces"
as permissive
for insert
to public
with check (((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id)));


create policy "workspaces_owner_read"
on "public"."workspaces"
as permissive
for select
to public
using (((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id)));


create policy "workspaces_owner_update"
on "public"."workspaces"
as permissive
for update
to public
using (((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id)))
with check (((auth.uid() IS NOT NULL) AND (auth.uid() = owner_id)));


create policy "workspaces_service_role_full_access"
on "public"."workspaces"
as permissive
for all
to public
using ((auth.role() = 'service_role'::text))
with check ((auth.role() = 'service_role'::text));


create policy "wp_mod"
on "public"."workspaces"
as permissive
for update
to public
using ((owner_id = auth.uid()))
with check ((owner_id = auth.uid()));


create policy "wp_select"
on "public"."workspaces"
as permissive
for select
to public
using (((owner_id = auth.uid()) OR user_has_org_link(id)));


CREATE TRIGGER trg_connected_accounts_updated_at BEFORE UPDATE ON public.connected_accounts FOR EACH ROW EXECUTE FUNCTION set_connected_accounts_updated_at();


