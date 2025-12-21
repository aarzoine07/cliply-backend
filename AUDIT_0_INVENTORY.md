# AUDIT 0 — Inventory & Integrity Gate

## A. Repo Identity

```
CMD: git rev-parse --abbrev-ref HEAD
OUTPUT: engine-surface-setup-merged-david-ariel
```

```
CMD: git rev-parse HEAD
OUTPUT: 80cc42a624be00fe840f00e55de356ed663b9907
```

```
CMD: git status -sb
OUTPUT: ## engine-surface-setup-merged-david-ariel...origin/engine-surface-setup-merged-david-ariel
 M supabase/.temp/cli-latest
```

```
CMD: git diff --name-only
OUTPUT: supabase/.temp/cli-latest
```

```
CMD: git diff --stat
OUTPUT:  supabase/.temp/cli-latest | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
```

## B. Toolchain Versions

```
CMD: node -v
OUTPUT: v22.20.0
```

```
CMD: pnpm -v
OUTPUT: 10.24.0
```

## C. Active Test Entry Points

### Root package.json scripts (test-related):

- `test`: `vitest run --reporter=verbose --config apps/web/vitest.config.ts`
- `test:worker:db`: `vitest run --no-file-parallelism test/worker/dead-letter-queue.test.ts test/worker/stuck-jobs.test.ts`
- `test:core`: `vitest run --reporter=verbose test/api/healthz.test.ts test/shared test/worker/dead-letter-queue.test.ts`
- `test:worker:dlq`: `vitest run --reporter=verbose test/worker/dead-letter-queue.test.ts`
- `test:coverage`: `vitest run --coverage`
- `test:snapshot`: `RUN_SNAPSHOT_HEALTH=true pnpm test apps/web/test/snapshot.health.test.ts`
- `test:watch`: `vitest --config apps/web/vitest.config.ts`
- `test:engine:e2e`: `vitest run test/engine/pipeline-flow-simple.e2e.test.ts`

### apps/web/package.json scripts (test-related):

- `test`: `vitest run`
- `test:watch`: `vitest`

### pnpm -w -s run output:

```
CMD: pnpm -w -s run | head -n 200
OUTPUT: Lifecycle scripts:
  test
    vitest run --reporter=verbose --config apps/web/vitest.config.ts

Commands available via "pnpm run":
  dev
    pnpm --parallel --filter "./apps/*" dev
  build
    pnpm -r build
  lint
    eslint . --ext .ts,.tsx,.js,.cjs,.mjs
  test:worker:db
    vitest run --no-file-parallelism test/worker/dead-letter-queue.test.ts test/worker/stuck-jobs.test.ts
  typecheck
    tsc -b
  test:core
    vitest run --reporter=verbose test/api/healthz.test.ts test/shared test/worker/dead-letter-queue.test.ts
  test:worker:dlq
    vitest run --reporter=verbose test/worker/dead-letter-queue.test.ts
  test:coverage
    vitest run --coverage
  test:snapshot
    RUN_SNAPSHOT_HEALTH=true pnpm test apps/web/test/snapshot.health.test.ts
  check:env
    tsx scripts/check-env.ts
  check:env:template
    tsx scripts/check-env-template-sync.ts
  backend:readyz
    tsx scripts/backend.readiness.ts
  smoke:backend
    pnpm backend:readyz
  format
    prettier . --check
  format:write
    prettier . --write
  devcheck
    bash scripts/dev-check.sh
  test:watch
    vitest --config apps/web/vitest.config.ts
  worker
    pnpm --filter @cliply/worker dev
  web
    pnpm --filter @cliply/web dev
  db:gen
    ts-node ./scripts/gen-types.ts
  db:apply:sql
    tsx scripts/db/apply-sql.ts
  dev:web
    tsx apps/web/src/server.ts
  dlq:list
    tsx scripts/dlq/list.ts
  dlq:inspect
    tsx scripts/dlq/inspect.ts
  dlq:requeue
    tsx scripts/dlq/requeue.ts
  jobs:stats
    tsx scripts/jobs/stats.ts
  jobs:status
    tsx scripts/jobs/status.ts
  workers:status
    tsx scripts/workers/status.ts
  test:engine:e2e
    vitest run test/engine/pipeline-flow-simple.e2e.test.ts
```

## D. Supabase Seed & Config Paths

```
CMD: test -f supabase/config.toml && echo "EXISTS" || echo "MISSING"
OUTPUT: EXISTS
```

- PATH: `supabase/config.toml`
- EXISTS: yes
- TRACKED: yes

```
CMD: test -f supabase/seed.sql && echo "EXISTS" || echo "MISSING"
OUTPUT: EXISTS
```

- PATH: `supabase/seed.sql`
- EXISTS: yes
- TRACKED: yes

```
CMD: git ls-files supabase | grep -i "seed\|config"
OUTPUT: supabase/config.toml
supabase/migrations/20251124000000_add_publish_config.sql
supabase/seed.sql
supabase/seed/seed.sql
```

**Discovered seed/config candidates:**
- `supabase/config.toml` (config file)
- `supabase/seed.sql` (seed SQL file)
- `supabase/seed/seed.sql` (seed SQL file)

## E. Test Setup / Reset Paths

```
CMD: test -f packages/shared/test/setup.ts && echo "EXISTS" || echo "MISSING"
OUTPUT: EXISTS
```

- PATH: `packages/shared/test/setup.ts`
- EXISTS: yes
- TRACKED: yes

```
CMD: git ls-files | grep -i "vitest\.config\."
OUTPUT: apps/web/vitest.config.ts
apps/worker/vitest.config.ts
vitest.config.ts
```

**Vitest config files found:**
- `apps/web/vitest.config.ts` (TRACKED: yes)
- `apps/worker/vitest.config.ts` (TRACKED: yes)
- `vitest.config.ts` (TRACKED: yes)

```
CMD: git ls-files packages/shared/test
OUTPUT: packages/shared/test/crypto/encryptedSecretEnvelope.test.ts
packages/shared/test/envSchema.test.ts
packages/shared/test/loadEnv.ts
packages/shared/test/setup.ts
```

**Setup-related files under packages/shared/test/:**
- `packages/shared/test/setup.ts`
- `packages/shared/test/loadEnv.ts`
- `packages/shared/test/envSchema.test.ts`
- `packages/shared/test/crypto/encryptedSecretEnvelope.test.ts`

```
CMD: git ls-files apps/web/test
OUTPUT: apps/web/test/api/accounts.patch-status.rls.test.ts
apps/web/test/api/accounts.publish.rls.test.ts
apps/web/test/api/accounts.rls.test.ts
apps/web/test/api/admin.readyz.integration.test.ts
apps/web/test/api/admin.readyz.test.ts
apps/web/test/api/audit-logging.test.ts
apps/web/test/api/billing.edge-cases.test.ts
apps/web/test/api/billing.status.test.ts
apps/web/test/api/clips.edge-cases.test.ts
apps/web/test/api/cron.scan-schedules.test.ts
apps/web/test/api/cron.schedules.edge-cases.test.ts
apps/web/test/api/health.integration.test.ts
apps/web/test/api/health.test.ts
apps/web/test/api/jobs.get-by-id.test.ts
apps/web/test/api/jobs.search.test.ts
apps/web/test/api/projects.detail.lifecycle.test.ts
apps/web/test/api/publish.edge-cases.test.ts
apps/web/test/api/readyz.integration.test.ts
apps/web/test/api/readyz.test.ts
apps/web/test/api/schedules.rls.test.ts
apps/web/test/api/tiktok-oauth.test.ts
apps/web/test/api/upload-init.test.ts
apps/web/test/api/upload.edge-cases.test.ts
apps/web/test/auth.debug-header-smoke.test.ts
apps/web/test/debug/cron-scan-client.test.ts
apps/web/test/debug/setup-exec.test.ts
apps/web/test/debug/supabase-class.test.ts
apps/web/test/integration/engine.flows.test.ts
apps/web/test/jobs.enqueue.test.ts
apps/web/test/jobs.idempotency.test.ts
apps/web/test/jobs.rls.test.ts
apps/web/test/jobs.service-role.test.ts
apps/web/test/routes.duplication.guard.test.ts
apps/web/test/snapshot.health.test.ts
apps/web/test/utils/engine/mockEngineSnapshot.ts
apps/web/test/utils/engine/mockPosting.ts
```

## F. Anchor File Fingerprints (git blob hashes)

```
CMD: git ls-files -s packages/shared/test/setup.ts
OUTPUT: 100644 7a78b15df67943ae79c94d999b3e19e44f255302 0	packages/shared/test/setup.ts
```

```
CMD: git ls-files -s supabase/config.toml
OUTPUT: 100644 2b479c21be2f3d0de78d96417f5da7f9cbb1c89d 0	supabase/config.toml
```

```
CMD: git ls-files -s supabase/seed.sql
OUTPUT: 100644 526c05f6c632799da554ded48f3cd459d9571d58 0	supabase/seed.sql
```

```
CMD: git ls-files -s package.json
OUTPUT: 100644 5beaaeb75ea1419732dfe9b7692d3319ce050ac5 0	package.json
```

```
CMD: git ls-files -s apps/web/package.json
OUTPUT: 100644 8f6479b523ba0af28646737c54de372cad98cd9a 0	apps/web/package.json
```

```
CMD: git ls-files -s apps/web/vitest.config.ts
OUTPUT: 100644 9d39d83610e65f522c8045b87b06bed096c5588f 0	apps/web/vitest.config.ts
```

```
CMD: git ls-files -s apps/worker/vitest.config.ts
OUTPUT: 100644 2b59d21100ac1cfc2408a8338d4e4511b6eac4a2 0	apps/worker/vitest.config.ts
```

```
CMD: git ls-files -s vitest.config.ts
OUTPUT: 100644 5db2315571c019b9cb892c14c3dfd30ec8754391 0	vitest.config.ts
```

```
CMD: git ls-files -s supabase/seed/seed.sql
OUTPUT: 100644 7f3b150d4eea2985afa247398f0da444b32da8e3 0	supabase/seed/seed.sql
```

**Summary of anchor file fingerprints:**
- `packages/shared/test/setup.ts`: `7a78b15df67943ae79c94d999b3e19e44f255302`
- `supabase/config.toml`: `2b479c21be2f3d0de78d96417f5da7f9cbb1c89d`
- `supabase/seed.sql`: `526c05f6c632799da554ded48f3cd459d9571d58`
- `package.json`: `5beaaeb75ea1419732dfe9b7692d3319ce050ac5`
- `apps/web/package.json`: `8f6479b523ba0af28646737c54de372cad98cd9a`
- `apps/web/vitest.config.ts`: `9d39d83610e65f522c8045b87b06bed096c5588f`
- `apps/worker/vitest.config.ts`: `2b59d21100ac1cfc2408a8338d4e4511b6eac4a2`
- `vitest.config.ts`: `5db2315571c019b9cb892c14c3dfd30ec8754391`
- `supabase/seed/seed.sql`: `7f3b150d4eea2985afa247398f0da444b32da8e3`

## G. MISSING / BLOCKERS

**BLOCKER: Working tree not clean**

The following file has uncommitted changes:
- `supabase/.temp/cli-latest` (modified, 1 insertion, 1 deletion)

**Impact:** Cannot compare cleanly across machines (Ariel + David) due to uncommitted modifications. The working tree must be clean for a valid comparison.
