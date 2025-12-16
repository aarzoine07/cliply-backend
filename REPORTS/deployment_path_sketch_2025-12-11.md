# Cliply Deployment Path – Sketch (Epic 3)

_Date: 2025-12-11_
_Branch: engine-surface-setup_

This document is a **high-level plan** for how Cliply gets deployed. It’s meant to be easy to read for founders, not deep dev-ops docs.

---

## 1. Branches, CI, and who is allowed to ship

**Reality right now**
- We are working on the `engine-surface-setup` branch. This is our “truth” branch for the Engine Surface work.
- CI currently runs 3 jobs on `engine-surface-setup`:
  - `backend-core` – env checks, build, basic readiness + core tests.
  - `lint` – code style check.
  - `extended-tests` – full test suite with coverage (currently non-blocking because of coverage thresholds).

**How we treat branches (model)**
- **Feature branches**:
  - Developers work on feature branches and open PRs into `engine-surface-setup`.
  - For these PRs, `backend-core` and `lint` must be green before merging.
  - `extended-tests` provides info but is not a hard blocker yet (Stage A).

- **engine-surface-setup → main**:
  - Once `engine-surface-setup` is in a good state (engine surface wired, tests stable), we merge it into `main`.
  - After that, `main` is the “production baseline” branch.
  - CI on `main` acts as the final gate before any deployment.

In simple terms:
> Work happens on feature branches → PR into `engine-surface-setup` → once stable, `engine-surface-setup` goes into `main` → only green CI on `main` is allowed to ship.

---

## 2. What actually gets deployed

Cliply has two main runtime pieces:

1. **API / Web backend** (`apps/web`)
   - Handles:
     - `/api/...` routes (upload, clips, publish, billing, cron, etc.).
     - Health and readiness endpoints like `/api/healthz` and `/api/readyz`.
   - This is the “brain” that the dashboard and tests talk to.

2. **Worker / Engine** (`apps/worker`)
   - Handles:
     - Background jobs and queues: download, transcribe, detect highlights, render clips, publish to TikTok/YouTube, cleanup, etc.
   - This is the “muscle” that actually processes video.

**Deployment end-state**
- There is at least one deployed instance of:
  - The **API backend** (web server for `/api/...` + health/readiness).
  - The **worker process** (engine that processes jobs).
- Both talk to the **same Supabase Postgres database**.
- Both share **the same family of environment variables** (SUPABASE\_*, STRIPE\_*, etc.).

When we say “deploy Cliply”, we mean:
> “Run the web/API server and run the worker process, both wired to the same Supabase DB and env vars.”

---

## 3. How database migrations fit into deployment

Migrations are changes to the database structure (tables, columns, indexes, etc.). For Cliply, they live under `supabase/migrations/...`.

**What we want, conceptually:**
1. Code changes are merged into `main`.
2. Before the new code is live, we apply **all new migrations** to the production database.
3. Only after migrations have been applied do we roll out the new API + worker code.

In simple words:
> “Before we ship new code, update the DB so the code and DB are in sync.”

**Execution options (future decision):**
- Manual: run migrations via Supabase CLI or Supabase Dashboard before triggering a deployment.
- Automated: a GitHub Actions job (or another pipeline) runs migrations against the production database whenever we deploy `main`.

For now, this sketch just defines the rule:
> “Deployment includes a DB step: run migrations, then roll out new API + worker.”

---

## 4. How environment variables flow (local → CI → production)

Cliply uses a lot of environment variables (for Supabase, Stripe, etc.). These values must never go into git – they live in secure config.

We effectively have **three env worlds**:

1. **Local development**
   - Developers use `.env.local`, `.env.test`, etc. on their own machines.
   - `pnpm dev` and `pnpm test` use these local files.

2. **CI (GitHub Actions) – test environment**
   - Uses **GitHub repository secrets** like:
     - `SUPABASE_TEST_URL`
     - `SUPABASE_TEST_ANON_KEY`
     - `SUPABASE_TEST_SERVICE_ROLE_KEY`
     - `STRIPE_SECRET_KEY`
     - `STRIPE_WEBHOOK_SECRET`
   - These secrets are only visible to CI, not to the public.

3. **Production runtime**
   - The hosting platform for the API and the worker will have its own “Environment variables” settings panel.
   - We store all production env values there (Supabase URL/keys, Stripe keys, etc.).

The key idea:
- The **code** always calls `getEnv("SUPABASE_URL")`, `getEnv("STRIPE_SECRET_KEY")`, etc.
- It does **not** care where the values come from.
- Local dev, CI, and production each have their own private values for the same variable names.

In one line:
> “We have one set of env variable names. Local, CI, and production each fill in their own values for those names.”

---

## 5. Role of `pnpm backend:readyz` and `/api/readyz`

We already have a script:
- `pnpm backend:readyz`
  - This script calls health/readiness endpoints and checks if the system looks healthy.
  - In CI, the `backend-core` job uses this as a smoke test.

**What we want this to mean:**
- **Pre-merge (CI gate):**
  - Before merging into `main`, CI runs `backend-core` which includes `backend:readyz`.
  - Once Engine Surface is fully wired, a passing `backend:readyz` should mean “this build looks safe to ship.”

- **Post-deploy (live readiness):**
  - After deployment, something (a script or uptime monitor) calls `/api/readyz` on the live environment.
  - If `/api/readyz` is OK → instance is healthy.
  - If it fails → we know the deployed environment is broken and needs attention.

For now we are in **Stage A**:
- `backend:readyz` is non-blocking in some CI cases while Engine Surface is still being wired.
- The **goal** is to move to Stage B where `backend:readyz` is a hard requirement.

---

## 6. End-to-end deployment story (simple flow)

Here is the full story in plain language:

1. **Do work on a feature branch.**
   - You or Ariel make changes on a feature branch.

2. **Open a PR into `engine-surface-setup`.**
   - CI runs:
     - `backend-core` (env, build, core readiness).
     - `lint` (code quality).
     - `extended-tests` (full test suite + coverage, currently non-blocking).
   - If `backend-core` and `lint` are green, the PR can be merged.

3. **Promote `engine-surface-setup` into `main`.**
   - Once `engine-surface-setup` is stable and represents the latest engine surface work, it gets merged into `main`.
   - CI on `main` is treated as the final gate before deployment.

4. **Run database migrations for production.**
   - Before rolling out new code, apply any new Supabase migrations to the production database.
   - This can be manual (via Supabase tools) or automated (via CI), but it must happen as part of the deployment process.

5. **Deploy API backend and worker.**
   - Deploy the `apps/web` server (API).
   - Deploy the `apps/worker` process (engine).
   - Both use the same production Supabase database and production env vars.

6. **Check readiness after deploy.**
   - Hit `/api/readyz` on the live URL or use a monitoring tool.
   - If `/api/readyz` is healthy, the system is considered up and ready to handle real users.

In short:
> PR → CI green → merge into main → run migrations → deploy API + worker → check `/api/readyz`.

---

## 7. Status of this document

- This is a **sketch**, not a full automation.
- It describes **how we want deployment to work**, in a way both founders and engineers can read.
- Future tasks in Epic 3 will:
  - Wire actual deployment scripts or actions.
  - Decide the exact hosting platform and how migrations are triggered.
  - Tighten `backend:readyz` into a strict gate for `main` and production.