# Backend Environment Readiness

This document defines the canonical commands for verifying backend environment readiness, both locally and in CI.

## Core Backend Commands (Local & CI)

These commands are the **minimal set that must be green** for the backend to be considered "deployment-ready":

### 0. Environment Validation (check:env)

Before running any other commands, validate your environment configuration:

```bash
pnpm check:env
```

**What it does:**
- Loads environment variables using the shared Zod schema
- Validates required variables for API (web) service
- Validates required variables for Worker service
- Provides clear feedback on missing or invalid variables

**Exit codes:**
- `0` — All environment checks passed ✅
- `1` — One or more checks failed ❌

**When to run:**
- ✅ First time setting up the project
- ✅ After modifying `.env.local` or `.env` files
- ✅ When CI fails with environment-related errors
- ✅ Before deploying to a new environment (staging, production)
- ✅ When troubleshooting "missing env var" errors

**What it validates:**
- **API requirements**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Worker requirements**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- **Schema validation**: All env vars match their Zod schema definitions (types, formats, constraints)

**Note**: This is a lightweight check focused on env var presence and format. For comprehensive readiness (DB connectivity, Stripe config, worker binaries), use `pnpm backend:readyz`.

---

### 0.1. Environment Template Sync Check

Ensures `.env.example` stays synchronized with the canonical Env schema:

```bash
pnpm check:env:template
```

**What it does:**
- Extracts all keys from `EnvSchema` (packages/shared/src/env.ts)
- Parses `.env.example` to extract all documented env var keys
- Compares the two sets and reports any missing or extra keys
- Outputs machine-readable JSON + human-friendly error messages

**Exit codes:**
- `0` — `.env.example` is in sync with `EnvSchema` ✅
- `1` — Mismatches detected (missing or extra keys) ❌

**When to run:**
- ✅ After adding or removing env vars from `EnvSchema`
- ✅ When updating `.env.example` documentation
- ✅ When CI fails on "Check env template sync"
- ✅ During local development to verify documentation is up-to-date

**What failures mean:**
- **Missing in .env.example**: A new env var was added to the schema but not documented. Add it to `.env.example` with appropriate comments.
- **Extra in .env.example**: A legacy env var remains in `.env.example` but was removed from the schema. Remove it from `.env.example` or add it back to `EnvSchema`.

**Purpose:**
This is a **documentation sync guard**, not an infrastructure test. It ensures developers always have an accurate, complete `.env.example` template that matches the runtime schema. This prevents confusion and "missing env var" issues during setup.

**Note**: This check runs automatically in CI's `backend-core` job to prevent doc drift.

---

### Backend Readiness Smoke Check

For a comprehensive infrastructure and configuration check before deployment:

```bash
pnpm backend:readyz
# or
pnpm smoke:backend
```

**What it does:**
- Uses `buildBackendReadinessReport()` from shared readiness helpers
- **Environment checks**: Validates all required and optional env vars
- **Database connectivity**: Tests Supabase connection and verifies critical tables exist (`workspaces`, `jobs`, `schedules`, `subscriptions`)
- **Stripe configuration**: Validates Stripe keys format and plan mappings (if configured)
- **Worker readiness**: Checks FFmpeg and yt-dlp binary availability
- **Sentry configuration**: Validates error monitoring setup (if configured)

**Exit codes:**
- `0` — All readiness checks passed, system is deployment-ready ✅
- `1` — One or more critical checks failed ❌

**Output format:**
- JSON report with detailed check results
- Machine-readable for automation and monitoring
- Human-readable with clear success/failure indicators

**When to run:**
- ✅ Before first deployment to a new environment
- ✅ When debugging infrastructure or configuration issues  
- ✅ As part of pre-release deployment checklist
- ✅ When troubleshooting connectivity problems
- ✅ After modifying infrastructure (DB, external services)

**Comparison with `check:env`:**
- `check:env`: Fast env var validation only (~1s, no network)
- `backend:readyz`: Comprehensive infrastructure check (~3-5s, includes DB/network)

**Use `check:env` for**: Quick pre-commit validation, env file debugging
**Use `backend:readyz` for**: Pre-deployment verification, infrastructure troubleshooting

---

### 1. Install dependencies

```bash
pnpm install
```

### 2. Typecheck

Ensures all TypeScript compiles without errors.

```bash
pnpm typecheck
```

### 3. Build

Compiles all packages and applications for deployment.

```bash
pnpm build
```

**What it does:**
- `packages/shared`: Compiles TypeScript to dist/
- `apps/web`: Builds Next.js application
- `apps/worker`: Compiles worker TypeScript

### 4. Core backend tests (health & readiness)

Runs a focused subset of tests that verify environment readiness without complex feature logic.

```bash
pnpm test:core
```

**What it includes:**
- `test/api/healthz.test.ts` — API health endpoint tests
- `test/shared/` — Shared module tests (env validation, usage tracking, video input)

**What it excludes:**
- Publish pipelines (TikTok, YouTube)
- Viral experiments & metrics
- Stripe webhook processing
- Dropshipping features
- Full API integration tests

---

## Full Test Suite vs Core Tests

### `pnpm test:core` (Required for deployment)

- **Purpose**: Verify backend environment is configured correctly
- **Scope**: Health checks, readiness, env validation, shared utilities
- **Must be**: ✅ Green on main/dev
- **Runtime**: ~2-3 seconds
- **CI Job**: `backend-core`

### `pnpm test` (Extended coverage)

- **Purpose**: Exercise feature-level API behavior
- **Scope**: Full API routes, publish pipelines, billing, viral features
- **Status**: May have failures related to Engine Surface features
- **Runtime**: ~10-30 seconds
- **CI Job**: `extended-tests`

The full test suite (`pnpm test` and `pnpm test:coverage`) exercises feature-level API behavior including publish flows, viral experiments, metrics, Stripe webhooks, and more. These tests are important but are not part of the minimal backend environment readiness gate. They may be owned by a separate "Engine Surface" track.

---

## CI Pipeline Structure

Our CI pipeline has two jobs:

### 1. `backend-core` (Deployment Gate)

**Must pass** for merging to main/deploying to production.

```yaml
- Install dependencies
- Check environment configuration (check:env)
- Check env template sync (check:env:template)  ← Documentation sync guard
- Type check
- Build
- Backend readiness smoke check (backend:readyz)
- Core backend tests
```

**The `backend:readyz` step** validates:
- All environment variables are present and valid
- Database connectivity and table schema
- Stripe configuration (if enabled)
- Worker binary availability (FFmpeg, yt-dlp)
- External service configurations

Failures in `backend-core` indicate **infrastructure or configuration issues** that must be resolved before deployment. These are distinct from feature bugs tested in `extended-tests`.

### 2. `extended-tests` (Feature Coverage)

Provides comprehensive test coverage and metrics. Failures here indicate feature-level issues, not env readiness problems.

```yaml
- Install dependencies
- Run full test suite
- Generate coverage report
- Upload coverage artifacts
```

---

## Local Development Workflow

### First-Time Setup

When setting up the project for the first time:

```bash
# 1. Copy environment template
cp .env.example .env.local

# 2. Fill in required values (see ENV.md)
# Edit .env.local with your Supabase credentials

# 3. Validate environment
pnpm check:env

# 4. Install and build
pnpm install && pnpm build

# 5. Verify full readiness (optional but recommended)
pnpm backend:readyz
```

### Pre-Commit Workflow

Before committing/pushing to main:

```bash
# Quick pre-commit check (recommended)
pnpm check:env && pnpm typecheck && pnpm test:core

# Full verification (optional, slower)
pnpm check:env && pnpm build && pnpm test
```

### Pre-Deployment Checklist

Before deploying to staging or production:

```bash
# Complete deployment readiness verification
pnpm check:env          # Fast env validation
pnpm build              # Ensure clean build
pnpm backend:readyz     # Comprehensive infrastructure check
pnpm test:core          # Core functionality tests
```

If all commands pass, the system is ready for deployment.

---

## Backend Readiness Script

For a comprehensive environment check (beyond just tests), run:

```bash
pnpm backend:readyz
```

This script (`scripts/backend.readiness.ts`) checks:
- ✅ Required environment variables present
- ✅ Database connectivity
- ✅ Critical tables exist
- ✅ Stripe configuration (if enabled)
- ✅ Worker binaries (FFmpeg, yt-dlp)
- ✅ Sentry configuration

**Use this for:**
- First-time environment setup
- Troubleshooting deployment issues
- Verifying production-like configurations locally

---

## Environment Setup

Before running any of these commands, ensure your environment is configured:

1. **Copy template**: `cp .env.example .env.local`
2. **Fill required values** (see `ENV.md` for details)
3. **For tests**: Create `.env.test` (see `TEST_ENV_SETUP.md`)

**Minimum required for core tests:**
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

See `.env.example` and `ENV.md` for complete environment variable documentation.

---

## Troubleshooting

### Core tests failing?

1. **Check environment**: `pnpm backend:readyz`
2. **Verify .env.test exists**: See `TEST_ENV_SETUP.md`
3. **Check Supabase connection**: Ensure credentials are valid

### Build failing?

1. **Clear caches**: `rm -rf node_modules .next dist && pnpm install`
2. **Check TypeScript**: `pnpm typecheck`
3. **Verify dependencies**: `pnpm install --no-frozen-lockfile`

### CI failing on backend-core?

This indicates a real environment readiness issue that **must be fixed** before deployment:
- Missing or invalid environment variables
- TypeScript compilation errors
- Critical health/readiness tests failing
- Build configuration issues

### CI failing on check:env:template?

This indicates `.env.example` is out of sync with `EnvSchema`:
1. Review the missing/extra keys reported in the CI logs
2. Update `.env.example` to match `EnvSchema` (packages/shared/src/env.ts)
3. If a key should exist, add it to `EnvSchema` first, then to `.env.example`

### CI failing on extended-tests?

This may indicate feature-level issues (Engine Surface track):
- Publish pipeline logic
- Viral experiment flows
- Stripe webhook handling
- These can be addressed separately from env readiness

---

## Related Documentation

- **Environment Variables**: `ENV.md` — Complete env var reference
- **Test Setup**: `TEST_ENV_SETUP.md` — Test environment configuration
- **Environment Template**: `.env.example` — Template for local setup
- **Readiness Checks**: `packages/shared/src/readiness/` — Readiness helper modules

---

**Last Updated**: 2025-12-08 (BE-06 implementation: env template sync check)

