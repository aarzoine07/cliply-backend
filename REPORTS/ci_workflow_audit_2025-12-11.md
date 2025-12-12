# CI Workflow Audit – 2025-12-11

## 1. Overview

- **2 workflow files** exist under `.github/workflows/` (ci.yml, trigger-ci.ts)
- **1 active workflow** (ci.yml) handles continuous integration with testing and validation
- **2-job structure**: core backend readiness + extended full test suite
- **pnpm-based monorepo** setup with Node 20, focused on health/readiness + API testing

## 2. Per-workflow detail

### ci.yml

**Triggers**
- `push` to branches: `[main, dev]`
- `pull_request` targeting branches: `[main, dev]`

**Jobs & commands**

- **backend-core** (runs-on: ubuntu-latest)
  - Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (all from secrets)
  - Steps:
    - `Checkout repository` (actions/checkout@v4)
    - `Install pnpm` (pnpm/action-setup@v3, version: 8)
    - `Setup Node.js` (actions/setup-node@v4, node-version: 20, cache: pnpm)
    - `Install dependencies` (pnpm install --no-frozen-lockfile)
    - `Check environment configuration` (pnpm run check:env)
    - `Check env template sync` (pnpm run check:env:template)
    - `Type check` (pnpm run typecheck)
    - `Build` (pnpm run build)
    - `Backend readiness smoke check` (pnpm run backend:readyz)
    - `Core backend tests (health & readiness)` (pnpm run test:core)

- **extended-tests** (runs-on: ubuntu-latest)
  - Environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (from secrets)
  - Steps:
    - `Checkout repository` (actions/checkout@v4)
    - `Install pnpm` (pnpm/action-setup@v3, version: 8)
    - `Setup Node.js` (actions/setup-node@v4, node-version: 20, cache: pnpm)
    - `Install dependencies` (pnpm install --no-frozen-lockfile)
    - `Run full test suite` (pnpm test)
    - `Run tests with coverage` (pnpm test:coverage)
    - `Upload coverage report` (actions/upload-artifact@v4, if: always, retention-days: 7)

**Notable assumptions / issues**
- No linting step in CI (pnpm lint script exists but not called)
- No explicit worker/engine testing (apps/worker tests not covered)
- Branches reference `main, dev` but current branch is `engine-surface-setup`
- Extended tests run full suite twice (pnpm test + pnpm test:coverage)
- Readiness check `backend:readyz` may fail on engine-surface-setup branch (based on smoke test results)
- No deployment or release workflows present

### trigger-ci.ts

**Triggers**
- No workflow triggers (appears to be a comment file only)

**Jobs & commands**
- No jobs or commands (just a timestamp comment: "trigger CI run Mon 10 Nov 2025 23:16:10 EST")

**Notable assumptions / issues**
- Not a functional workflow file, just documentation/comment

## 3. Quick findings for David

- **Single active workflow** covers both core readiness and extended testing, running on push/PR to main/dev branches
- **No linting in CI** despite pnpm lint script existing in package.json
- **No worker/engine testing** - CI only runs apps/web tests, not apps/worker
- **Branch mismatch** - workflow triggers on main/dev but current branch is engine-surface-setup
- **Readiness check may fail** - pnpm run backend:readyz likely fails on current branch (404s for /api/readyz based on smoke test results)
- **Test duplication** - extended-tests job runs full test suite twice (normal + coverage)
- **No deployment workflows** - CI is testing-only, no build/deploy steps
- **Environment dependencies** - requires 5 secrets (SUPABASE_* x3, STRIPE_* x2) for core tests to pass
- **pnpm version pinned to 8** - may need updating to match package.json (uses pnpm@10.24.0+sha512...)