# CI Behavior Plan – 2025-12-11

## 1. Goals for CI on this project

CI should guarantee these core qualities before code merges to main:

- **Environment sanity**: All required environment variables are configured and valid
- **Type safety**: TypeScript compilation succeeds with no type errors
- **Build success**: All packages and apps build successfully
- **Backend readiness**: Health/readiness endpoints respond correctly
- **Core functionality**: Basic API tests (health, auth, billing) pass
- **Code quality**: No linting violations in the codebase
- **Test coverage**: Full test suite passes with coverage reporting

## 2. Jobs we want in CI (by role)

### core (required for merge)
- **Commands**: `check:env`, `check:env:template`, `typecheck`, `build`, `backend:readyz`, `test:core`
- **Env/secrets needed**: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
- **Purpose**: Validates environment, types, build, and basic backend readiness
- **Required**: Yes - must pass for any merge to main

### lint (required for merge)
- **Commands**: `lint`
- **Env/secrets needed**: None
- **Purpose**: Ensures code quality and consistent formatting
- **Required**: Yes - must pass for any merge to main

### extended-tests (required for merge)
- **Commands**: `test:coverage` (includes full test suite + coverage reporting)
- **Env/secrets needed**: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
- **Purpose**: Runs complete test suite with coverage metrics and artifact upload
- **Required**: Yes - must pass for any merge to main

### worker-tests (required for merge, if applicable)
- **Commands**: `test` scoped to apps/worker tests (when worker tests exist)
- **Env/secrets needed**: Worker-specific environment variables
- **Purpose**: Validates worker/engine functionality separately from web API tests
- **Required**: Yes - but currently no worker tests exist, so this job would be empty/skip

## 3. When each job should run

| Job | PR to main | Push to main | Feature branches (like engine-surface-setup) |
|-----|------------|--------------|---------------------------------------------|
| core | ✅ Run | ✅ Run | ✅ Run (for development feedback) |
| lint | ✅ Run | ✅ Run | ✅ Run (for development feedback) |
| extended-tests | ✅ Run | ✅ Run | ❌ Skip (too slow for frequent commits) |
| worker-tests | ✅ Run | ✅ Run | ❌ Skip (when tests exist) |

**Trigger rules in plain language:**
- **PR to main**: All jobs run - must all pass before merge
- **Push to main**: All jobs run - catches any post-merge issues
- **Feature branches**: Only core + lint run for fast feedback during development

## 4. How to handle test duplication + coverage

**Problem**: Current CI runs `pnpm test` then `pnpm test:coverage`, duplicating the full test suite.

**Solution**: Replace both commands with just `pnpm test:coverage` in the extended-tests job.

**Why**: `test:coverage` already runs the full test suite (same as `pnpm test`) plus generates coverage reports and artifacts. This eliminates duplication while maintaining coverage reporting, which is more valuable than bare test execution in CI.

## 5. How to treat backend:readyz while endpoints are still being wired

**Current issue**: `backend:readyz` script checks endpoints like `/api/readyz` that return 404 on engine-surface-setup branch.

**Staged approach:**

**Stage A (now)**: Keep `backend:readyz` in core job but make it non-blocking on this branch. Use a conditional check that allows 404s or logs warnings without failing the job.

**Stage B (later)**: Once all readiness endpoints are implemented and passing locally, make `backend:readyz` a hard requirement that fails the core job on any 404s or readiness failures.

**Implementation**: Add a flag like `ALLOW_READINESS_404=true` in CI environment for Stage A, removed once endpoints are stable.

## 6. Known dependencies and risk notes

- **Secrets required**: 5 secrets needed (SUPABASE_* x3, STRIPE_* x2) - CI will fail without them configured
- **Branch mismatch**: CI triggers only on main/dev but we're working on engine-surface-setup
- **Worker testing gap**: No worker-specific tests exist yet, worker-tests job would be empty
- **Readiness check fragility**: backend:readyz depends on API endpoints that aren't wired yet
- **pnpm version**: CI uses pnpm v8 but package.json specifies v10 - may cause inconsistencies
- **Test dependencies**: Extended tests require Supabase connectivity, may be slow/flaky

## 7. Action checklist for "when we actually edit CI YAML"

1. Update ci.yml triggers to include engine-surface-setup and align with actual main branch names
2. Restructure jobs: separate lint job, consolidate extended-tests to avoid duplication
3. Add conditional logic for backend:readyz (allow failures in Stage A)
4. Update pnpm version in CI to match package.json (v8 → v10)
5. Add worker-tests job structure (even if empty) for when worker tests are added
6. Verify all required secrets are configured in GitHub repository settings