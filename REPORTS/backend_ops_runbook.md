# Backend Ops Runbook – Cliply Machine v1

**Branch:** `backend-readiness-v1`  
**Owner:** Person 1 (Ariel – Backend Readiness)  
**Last updated:** 2025-12-10

This runbook explains how to operate and troubleshoot the backend readiness and health model for Cliply Machine v1.

It ties together:

- Health & readiness endpoints
- Engine health snapshot
- Job queue & dead-letter queue (DLQ)
- Env & RLS posture
- Core test and env checks

The goal: when something is red or degraded, you have a **short, predictable checklist**.

---

## 1. Key Endpoints & What They Mean

### 1.1 `/api/healthz` – Liveness (Is the app up?)

- **Purpose:** Very cheap “is the process up and responding?” check.
- **Used for:** Basic uptime monitoring and container health checks.
- **Behavior:**
  - Returns `200` with a small JSON body.
  - Does **not** perform heavy DB or queue checks.
- **If `/api/healthz` is down:**
  - Treat as **hard outage** (process not running, crash loop, or network misconfig).
  - See section 3.1 (Healthz red).

---

### 1.2 `/api/readyz` – Readiness (Can we serve traffic?)

- **Purpose:** Report whether the system is “ready enough” to handle user traffic.
- **Powered by:** `buildBackendReadinessReport({ includeDetailedHealth: true })`
- **Shape (simplified):**

  ```ts
  type BackendReadinessReport = {
    ok: boolean;
    checks?: {
      db?: { ok: boolean; message?: string };
      worker?: { ok: boolean; message?: string };
    };
    queue?: {
      length: number;
      oldestJobAge: number | null;
      warning?: boolean;
    };
    ffmpeg?: {
      ok: boolean;
      message?: string;
    };
    // admin variants may include extra metadata (e.g. timestamp)
  };
If ok === true:

DB, worker, queue and ffmpeg are in an acceptable state.

If ok === false:

One or more checks (db, worker, queue, ffmpeg) is degraded or failing.

Use the fields under checks, queue, and ffmpeg to locate the issue.

See sections 3.2–3.4.

1.3 /api/admin/readyz – Detailed Readiness (Ops / admin)
Purpose: Same underlying readiness model, but with extra detail and metadata for internal use.

Differences vs /api/readyz:

Called with includeDetailedHealth: true and a Supabase service-role client.

May include an explicit timestamp and richer queue metrics.

Use it when:

You are on-call or debugging and need more detail than /api/readyz provides.

You want to correlate “red” state with DB/queue-level metrics.

2. Engine Health Snapshot & Queue / DLQ
2.1 Engine Health Snapshot
The engine health snapshot logic (see ER-04 report and tests) is responsible for:

Inspecting the jobs table and aggregating:

Queue length

Oldest job age

Worker activity from recent heartbeats

Recent errors and DLQ volume

Deriving a high-level ok flag for the engine.

It feeds into the readiness report’s queue and some checks.worker fields.

Key behaviors (from tests):

Handles an empty database gracefully (ok stays true).

Calculates oldest job age correctly.

Aggregates jobs by state (queued, running, completed, dead_letter, etc.).

Marks ok=false when:

FFmpeg is not available, or

There are too many dead_letter jobs.

2.2 Job Queue & Dead-Letter Queue (DLQ)
Jobs live in the jobs table.

A job that fails too many times (retries > max_attempts) is moved to state dead_letter.

The DLQ protects the system from poison jobs that would otherwise keep failing forever.

From the DLQ tests:

“Poison” jobs:

are claimed, attempted, and eventually move to dead_letter.

DLQ jobs:

are never claimed again by normal workers.

There is a requeue helper that:

Takes a dead_letter job and moves it back to queued (with proper guards).

Throws if you attempt to requeue jobs that are not in dead_letter or don’t exist.

When DLQ grows, treat that as a symptom of:

Broken upstream integration (e.g. invalid input, bad external API).

Regression in worker code.

Misconfigured env variables (e.g. credentials, URLs).

3. Standard Triage Scenarios
This is the core of the runbook: what to do when something is red.

3.1 /api/healthz is red (or unreachable)
Symptoms:

Uptime monitoring shows 5xx / timeouts on /api/healthz.

App does not respond or crashes immediately.

Checklist:

Check deployment / container status

Is the process actually running?

Look for crash loops, OOM, or startup errors.

Check env configuration

Confirm the deployed environment has all required env vars:

Local: compare with .env.example.

CI/Prod: compare environment with packages/shared/src/env.ts.

Run local sanity checks (dev machine)

pnpm test:core

pnpm check:env:template

If these fail locally, fix before redeploying.

Check error logging

Inspect logs / Sentry (if DSN configured) around the time of failure.

Restart or roll back

If a recent deploy caused the issue, roll back to the previous known-good build.

3.2 /api/readyz is red, /api/healthz is green
Symptoms:

App responds, but readiness is ok=false.

/api/admin/readyz shows which sub-component is red.

Checklist:

Inspect readiness payload

Call /api/admin/readyz and inspect:

checks.db

checks.worker

queue

ffmpeg

If checks.db.ok === false:

Check Supabase / Postgres:

Is the DB reachable?

Any connection limit / authentication issues?

Validate env:

SUPABASE_URL

SUPABASE_ANON_KEY

SUPABASE_SERVICE_ROLE_KEY

DATABASE_URL (if used directly by workers).

Re-run locally:

pnpm test:core

Fix credentials or connectivity and redeploy.

If checks.worker.ok === false:

Check worker processes:

Are workers deployed and running?

Any crash loops or misconfigurations?

Look at DLQ / jobs table via Supabase:

Are jobs stuck in a specific state?

Check logs around worker startup and job execution.

If queue.warning === true or queue.length is high:

See section 3.3 (Queue backlog).

If ffmpeg.ok === false:

Verify ffmpeg availability in the environment:

Binary exists and is executable.

PATH includes ffmpeg.

Confirm any ffmpeg wrapper or worker container has ffmpeg installed.

After fixing, redeploy workers and re-check /api/admin/readyz.

3.3 Queue backlog / slow processing
Symptoms:

queue.length is high.

oldestJobAge is large (jobs waiting for a long time).

Users report long processing times.

Checklist:

Check worker capacity

Are workers running?

Has the number of workers changed (auto-scaling, manual change)?

Are workers frequently crashing or restarting?

Check DLQ volume

If many jobs end up in dead_letter, this might look like a backlog but is actually systemic failure.

See section 3.4.

Look at job types

Are specific job kinds (e.g. clip rendering, ingest) piling up?

Check for regressions or external API changes affecting those paths.

Short-term relief options

Scale up worker count (if supported).

Temporarily throttle new job creation (rate limiting at API layer).

After fixing

Monitor /api/readyz and the queue metrics until:

queue.length returns to normal.

oldestJobAge drops to an acceptable range.

3.4 DLQ growth / poison jobs
Symptoms:

Number of dead_letter jobs keeps growing.

ffmpeg.ok or readiness ok may go red if DLQ thresholds are exceeded.

Specific job kinds repeatedly fail.

Checklist:

Inspect dead_letter jobs

Use Supabase or internal admin tools to query jobs where state = 'dead_letter'.

Look at:

kind

error message / metadata

attempts, max_attempts

Identify pattern

Is the failure due to:

Bad input (e.g. invalid URLs)?

External service errors (e.g. TikTok/YouTube, Deepgram, ffmpeg)?

Internal code errors (exceptions, type errors)?

Fix root cause

For bad input: tighten validation and return clear errors to callers.

For external services: update credentials, handle new API behavior, add retries with backoff.

For internal bugs: fix code, add regression tests, and redeploy.

Requeue carefully

Use the worker’s requeue helper or admin tools:

Only requeue jobs after the underlying bug is fixed.

Confirm:

Requeued jobs move from dead_letter → queued.

No repeated poisoning.

Monitor after requeue

Watch DLQ size and readiness status.

Ensure the same jobs do not re-enter dead_letter.

4. Env & RLS Troubleshooting
4.1 Env checks
Core commands:

bash
Copy code
pnpm test:core
pnpm check:env:template
pnpm test:core:

Runs your critical health, engine snapshot, DLQ, and shared tests.

Must be green before you consider the backend “ready”.

pnpm check:env:template:

Verifies .env.example is in sync with EnvSchema in packages/shared/src/env.ts.

Output:

✅ ok: true → template matches the schema.

❌ ok: false → keys are missing or extra; fix .env.example or the schema.

Use .env.example as the source of truth when configuring new environments (local / staging / prod).

4.2 RLS posture (jobs table)
Current jobs RLS is stabilized via migration:
supabase/migrations/20251210163500_jobs_rls_stabilization.sql

Effective policies:

jobs_service_role_full_access (role: service_role)

ALL operations allowed.

Used by workers and backend services with the service-role key.

jobs_workspace_member_select (role: authenticated)

USING (public.is_workspace_member(workspace_id))

SELECT-only; no INSERT/UPDATE/DELETE for normal users.

If you see errors like “permission denied for table jobs”:

Check which key / client is being used:

Service-role key should bypass RLS.

Anonymous/normal user must be a workspace member to read jobs.

Confirm the workspace membership is set up correctly.

For a full RLS overview, see:
REPORTS/rls_posture_backend-readiness-v1.md

The RLS integration tests for jobs live in:
test/rls/jobs.rls.test.ts (currently describe.skip due to workspace insert grants in the shared Supabase project).

5. Quick Ops Checklist (TL;DR)
When something is wrong, run this checklist from top to bottom:

Is the app up?

Check /api/healthz.

If red → Section 3.1.

Is the app ready?

Check /api/readyz.

If red → call /api/admin/readyz and inspect:

checks.db, checks.worker, queue, ffmpeg.

Follow Sections 3.2–3.4 based on which field is failing.

Are tests green?

Run locally:

pnpm test:core

pnpm check:env:template

Fix failing tests or env mismatches before redeploy.

Is the queue or DLQ unhealthy?

If queue.length is high or DLQ grows:

See Sections 3.3 and 3.4.

Is it an access / RLS issue?

If you see “permission denied” from Supabase:

Confirm which client/key is used.

Check jobs RLS posture.

Ensure workspace membership is correct.

6. Future Improvements (Backlog)
These are nice-to-have extensions for later:

Add RLS tests for more tables (projects, clips, schedules).

Re-enable jobs RLS tests (remove describe.skip) once workspace creation is supported in a dedicated test DB.

Wire pnpm check:env:template into CI/CD as a required step.

Add small admin tools or dashboards to visualize:

Ready status history

Queue length & DLQ trends

Recent engine health snapshots

yaml
Copy code
