# T2-00: Health/Readiness Endpoints Inventory and Consolidation Plan

**Status:** Discovery Complete  
**Date:** 2025-12-14  
**Branch:** `backend-readiness-v1`  
**Task:** T2-00 (Discovery Only - No Code Changes)

**Note:** T2-01 implementation completed on 2025-12-14. Phase 1 (contract alignment) is complete.

---

## 1. Executive Summary

The Cliply backend monorepo currently has **9 distinct health/readiness endpoints** across Pages Router, App Router, and Express server implementations. These endpoints exhibit significant **contract drift** (different response shapes for similar concepts) and **duplication** (multiple endpoints serving the same purpose). The primary issues are:

- **3 different `/api/health` implementations** (Express, Pages Router, legacy Pages) with different contracts
- **2 readiness endpoints** (`/api/readyz`, `/api/admin/readyz`) that are nearly identical except for a timestamp field
- **Specialized endpoints** (`/api/analytics/health`, `/api/health/audit`) with domain-specific contracts
- **Inconsistent status code semantics** (200/503/500 usage varies)
- **Type safety gaps** (tests mock fields that don't exist in `BackendReadinessReport` type)

**Recommendation:** Consolidate to 3 canonical endpoints: `/api/healthz` (liveness), `/api/readyz` (readiness), and `/api/admin/readyz` (admin readiness with timestamp). Align all implementations to use `buildBackendReadinessReport()` with consistent response shapes.

---

## 2. Endpoint Inventory Table

| Route | Router | File Path | Purpose | Current Response Keys (Top-Level) | Notes |
|-------|--------|-----------|---------|-----------------------------------|-------|
| `/api/health` | Express | `apps/web/src/server.ts` | Express server health check | `ok`, `service`, `env`, `uptime_ms`, `db`, `db_name?`, `db_error?` | Always returns 200; basic DB connectivity check |
| `/api/health` | Pages | `apps/web/src/pages/api/health.ts` | Lightweight health indicator | `ok` | Uses `buildBackendReadinessReport()`; returns 200/503/500 |
| `/api/health` | Pages (legacy) | `apps/web/pages/api/health.ts` | Legacy stub endpoint | `ok`, `message` | Always returns 200; no actual checks |
| `/api/healthz` | Pages | `apps/web/src/pages/api/healthz.ts` | Liveness check (process alive) | `ok`, `service`, `ts` | Always returns 200; no external checks; fastest endpoint |
| `/api/readyz` | Pages | `apps/web/src/pages/api/readyz.ts` | Public readiness check | `ok`, `checks`, `queue`, `ffmpeg` | Uses `buildBackendReadinessReport(includeDetailedHealth: true)`; returns 200/503/500 |
| `/api/admin/readyz` | Pages | `apps/web/src/pages/api/admin/readyz.ts` | Admin/SRE readiness check | `ok`, `checks`, `queue`, `ffmpeg`, `timestamp` | Same as `/api/readyz` + ISO timestamp; returns 200/503/500/405 |
| `/api/analytics/health` | Pages | `apps/web/src/pages/api/analytics/health.ts` | Analytics-specific health | `ok`, `ts`, `db`, `activeWorkers` | Custom implementation; checks DB + active workers (heartbeat-based); returns 200/500 |
| `/api/health/audit` | App | `apps/web/src/app/api/health/audit/route.ts` | Workspace audit health snapshot | `ok`, `data?`, `error?` | Requires `workspace_id` query param; returns 200/401/500 |
| `/api/dashboard/ready` | Pages | `apps/web/src/pages/api/dashboard/ready.ts` | **NOT a health endpoint** | `ok`, `items` | Returns ready clips for dashboard; requires auth; not a system health check |

**Key Observations:**
- `/api/dashboard/ready` is **NOT a health endpoint** (returns clip data, not system status)
- Express `/api/health` is separate from Next.js endpoints (different server)
- Legacy `/api/health` in `apps/web/pages/` is a stub (always returns 200 with message)
- `/api/healthz` is the only endpoint with **zero external dependencies** (pure liveness)
- `/api/readyz` and `/api/admin/readyz` are **nearly identical** (only difference: timestamp)

---

## 3. Contract Drift Map

### 3.1 Health Endpoints (Liveness - "Is the process alive?")

**Group:** `/api/health` (3 implementations), `/api/healthz`

| Endpoint | Response Shape | Status Codes | Checks Performed |
|----------|---------------|--------------|------------------|
| `/api/health` (Express) | `{ ok, service, env, uptime_ms, db, db_name?, db_error? }` | Always 200 | DB connectivity via `pgCheck()` |
| `/api/health` (Pages) | `{ ok }` | 200/503/500 | Full `buildBackendReadinessReport()` (but only returns `ok`) |
| `/api/health` (Legacy) | `{ ok, message }` | Always 200 | None (stub) |
| `/api/healthz` | `{ ok, service, ts }` | Always 200 | None (pure liveness) |

**Drift Issues:**
- Express version includes `service`, `env`, `uptime_ms`; Pages version does not
- Express version always returns 200; Pages version uses 503 for unhealthy
- Legacy version is a stub with no actual checks
- `/api/healthz` is the only one with zero dependencies (fastest)

**Recommendation:** Standardize on `/api/healthz` for liveness (already optimal). Deprecate other `/api/health` variants.

---

### 3.2 Readiness Endpoints (Detailed - "Can we serve traffic?")

**Group:** `/api/readyz`, `/api/admin/readyz`

| Endpoint | Response Shape | Status Codes | Checks Performed |
|----------|---------------|--------------|------------------|
| `/api/readyz` | `{ ok, checks: { db, worker }, queue: { length, oldestJobAge, warning? }, ffmpeg: { ok, message? } }` | 200/503/500 | Full readiness via `buildBackendReadinessReport(includeDetailedHealth: true)` |
| `/api/admin/readyz` | Same as `/api/readyz` + `timestamp: string` | 200/503/500/405 | Same as `/api/readyz` |

**Drift Issues:**
- **Minimal drift** - Only difference is `timestamp` field in admin version
- Both use same underlying `buildBackendReadinessReport()` function
- Both have same status code semantics

**Recommendation:** Keep both (public vs admin distinction is useful). Ensure both use identical base contract.

---

### 3.3 Specialized Health Endpoints (Domain-Specific)

**Group:** `/api/analytics/health`, `/api/health/audit`

| Endpoint | Response Shape | Status Codes | Purpose |
|----------|---------------|--------------|---------|
| `/api/analytics/health` | `{ ok, ts, db, activeWorkers }` | 200/500 | Analytics monitoring (worker heartbeat tracking) |
| `/api/health/audit` | `{ ok, data?: { workspace_id, last_event_at, total_events, stale_events, integrations }, error? }` | 200/401/500 | Workspace audit compliance health |

**Drift Issues:**
- `/api/analytics/health` uses custom implementation (not `buildBackendReadinessReport()`)
- `/api/analytics/health` checks worker heartbeats (domain-specific metric)
- `/api/health/audit` requires `workspace_id` query param (not a general health check)
- Both have unique response shapes that don't align with canonical readiness contract

**Recommendation:** Keep as specialized endpoints but document their purpose clearly. Consider renaming to `/api/analytics/status` and `/api/compliance/audit-health` to avoid confusion with general health endpoints.

---

## 4. Proposed Canonical Contracts (Draft)

### 4.1 Health (Liveness) Contract

**Endpoint:** `GET /api/healthz`  
**Purpose:** Fast liveness check (no external dependencies)  
**Status Codes:** Always 200 (process is alive if responding)

```json
{
  "ok": true,
  "service": "api",
  "ts": "2025-01-27T12:34:56.789Z"
}
```

**Schema:**
- `ok` (boolean, required): Always `true` if endpoint responds
- `service` (string, required): Service identifier (e.g., "api")
- `ts` (string, required): ISO 8601 timestamp of check

**Rationale:** Zero external calls = fastest possible response. Used by load balancers for basic liveness.

---

### 4.2 Readiness (Public) Contract

**Endpoint:** `GET /api/readyz`  
**Purpose:** Comprehensive readiness check for load balancers and monitoring  
**Status Codes:** 200 (ready), 503 (not ready), 500 (internal error)

```json
{
  "ok": true,
  "checks": {
    "db": { "ok": true },
    "worker": { "ok": true, "message": "Worker ready" }
  },
  "queue": {
    "length": 5,
    "oldestJobAge": 30000,
    "warning": false
  },
  "ffmpeg": {
    "ok": true
  }
}
```

**Schema:**
- `ok` (boolean, required): Overall readiness status
- `checks` (object, required):
  - `db` (object, required): `{ ok: boolean, message?: string }`
  - `worker` (object, required): `{ ok: boolean, message?: string }`
- `queue` (object, required):
  - `length` (number, required): Total pending + running jobs
  - `oldestJobAge` (number | null, required): Age of oldest job in seconds, or `null` if queue empty
  - `warning` (boolean, optional): `true` if queue is backed up (>50 jobs or oldest >1 hour)
- `ffmpeg` (object, required): `{ ok: boolean, message?: string }`

**Error Response (500):**
```json
{
  "ok": false,
  "error": {
    "message": "internal_error"
  }
}
```

**Rationale:** Standard Kubernetes-style readiness check. Used by load balancers to route traffic.

---

### 4.3 Admin Readiness Contract

**Endpoint:** `GET /api/admin/readyz`  
**Purpose:** Same as `/api/readyz` but with timestamp for SRE/admin tooling  
**Status Codes:** 200 (ready), 503 (not ready), 500 (internal error), 405 (method not allowed)

**Response:** Same as `/api/readyz` + `timestamp` field:

```json
{
  "ok": true,
  "checks": { ... },
  "queue": { ... },
  "ffmpeg": { ... },
  "timestamp": "2025-01-27T12:34:56.789Z"
}
```

**Schema:** Extends readiness contract with:
- `timestamp` (string, required): ISO 8601 timestamp of check

**Rationale:** Timestamp useful for monitoring dashboards and alerting systems.

---

### 4.4 Backward Compatibility Notes

**Fields to preserve during consolidation:**

1. **Express `/api/health`** → Migrate to `/api/healthz`:
   - `service`: Already present in `/api/healthz`
   - `env`: Can be added as optional field if needed
   - `uptime_ms`: Can be added as optional field if needed
   - `db`, `db_name`, `db_error`: Not needed (covered by `/api/readyz`)

2. **Legacy `/api/health`** → Remove (stub endpoint, no real functionality)

3. **`/api/analytics/health`** → Keep as-is (specialized endpoint):
   - `activeWorkers`: Domain-specific metric, not part of general readiness
   - Consider renaming to `/api/analytics/status` to avoid confusion

4. **`/api/health/audit`** → Keep as-is (specialized endpoint):
   - Workspace-scoped, not general health
   - Consider renaming to `/api/compliance/audit-health` to avoid confusion

---

## 5. Consolidation Plan (Phased)

### Phase 1: Align Response Shapes (No Breaking Changes)

**Goal:** Standardize all endpoints to use canonical contracts while maintaining backward compatibility.

**Tasks:**

1. **Update `/api/readyz` and `/api/admin/readyz` to use canonical contract:**
   - Ensure `buildBackendReadinessReport()` returns fields matching canonical schema
   - Add defensive checks for optional fields (already present in code)
   - Verify tests pass with canonical shape

2. **Enhance `/api/healthz` (if needed):**
   - Already optimal; no changes required
   - Document as canonical liveness endpoint

3. **Add compatibility fields to Express `/api/health` (if still in use):**
   - Add `ts` field to match `/api/healthz` pattern
   - Document deprecation notice (point to `/api/healthz`)

4. **Document specialized endpoints:**
   - Add comments to `/api/analytics/health` and `/api/health/audit` explaining they are domain-specific
   - Consider adding `_meta.purpose` field to responses for clarity

**Risks:**
- Low risk: Additive changes only
- Tests may need updates if they assert exact response shapes

**Mitigations:**
- Run full test suite: `pnpm test:core`
- Verify all endpoints return expected shapes
- Check monitoring/alerting systems still work

---

### Phase 2: Deprecate Legacy Routes

**Goal:** Mark redundant endpoints as deprecated and redirect to canonical endpoints.

**Tasks:**

1. **Deprecate Express `/api/health`:**
   - Add `X-Deprecated: true` header
   - Add `X-Deprecation-Message: "Use /api/healthz for liveness or /api/readyz for readiness"`
   - Optionally: Return 301 redirect to `/api/healthz` (if Express server still in use)

2. **Deprecate Legacy `/api/health` (Pages Router stub):**
   - Add deprecation notice in response
   - Document removal in Phase 3

3. **Update documentation:**
   - Mark deprecated endpoints in API docs
   - Update runbooks to reference canonical endpoints
   - Update monitoring configs to use canonical endpoints

**Risks:**
- Medium risk: External systems may depend on deprecated endpoints
- Breaking change if redirects are not handled gracefully

**Mitigations:**
- Add deprecation headers (non-breaking)
- Monitor usage of deprecated endpoints (log access)
- Provide migration guide for external consumers
- Keep deprecated endpoints active for 1-2 release cycles

---

### Phase 3: Remove Duplicates (After Client Migration)

**Goal:** Remove deprecated endpoints once all clients have migrated.

**Tasks:**

1. **Remove Express `/api/health`:**
   - Only if Express server is no longer in use
   - Verify no external dependencies

2. **Remove Legacy `/api/health` stub:**
   - Delete `apps/web/pages/api/health.ts`
   - Verify no references in codebase

3. **Final verification:**
   - Run full test suite
   - Verify monitoring uses canonical endpoints
   - Update all documentation

**Risks:**
- High risk: Breaking change if clients haven't migrated
- May break external monitoring/alerting

**Mitigations:**
- Only proceed after monitoring shows zero usage of deprecated endpoints
- Coordinate with ops team before removal
- Keep removal as separate PR for easy rollback

---

## 6. Acceptance Checklist for T2-01 Implementation

### Pre-Implementation Verification

- [ ] All existing tests pass: `pnpm test:core`
- [ ] Build succeeds: `pnpm build`
- [ ] No linter errors: `pnpm lint` (if applicable)
- [ ] Current endpoint responses documented (this report)

### Phase 1 Implementation Criteria

- [ ] `/api/readyz` returns canonical readiness contract shape
- [ ] `/api/admin/readyz` returns canonical admin readiness contract shape (includes `timestamp`)
- [ ] `/api/healthz` returns canonical liveness contract shape (already correct)
- [ ] All endpoints use `buildBackendReadinessReport()` consistently
- [ ] Tests updated to assert canonical contract shapes
- [ ] No breaking changes to existing response fields (additive only)

### Verification Commands

```bash
# 1. Run core tests (must pass)
pnpm test:core

# 2. Run health/readiness endpoint tests specifically
pnpm test apps/web/test/api/health.test.ts
pnpm test apps/web/test/api/readyz.test.ts
pnpm test apps/web/test/api/admin.readyz.test.ts
pnpm test test/api/healthz.test.ts

# 3. Verify build succeeds
pnpm build

# 4. Manual verification (if local server running)
curl http://localhost:3000/api/healthz
curl http://localhost:3000/api/readyz
curl http://localhost:3000/api/admin/readyz
```

### Expected Results

1. **All tests pass** (no regressions)
2. **Build succeeds** (no TypeScript errors)
3. **Response shapes match canonical contracts** (verified in tests)
4. **No breaking changes** (existing fields preserved, new fields additive)
5. **Status codes unchanged** (200/503/500 semantics preserved)

### "No Breaking Change" Criteria

- ✅ Existing `ok` field present and same type
- ✅ Existing `checks`, `queue`, `ffmpeg` fields present (if endpoint previously returned them)
- ✅ Status codes unchanged (200/503/500)
- ✅ No fields removed (only added or renamed with backward-compatible aliases)
- ✅ Response structure remains JSON (no format changes)

### Rollback Plan

If issues arise:
1. Revert PR immediately
2. Verify tests pass on previous commit
3. Document issue in T2-01 follow-up task
4. Re-assess consolidation approach

---

## 7. Appendix: Search Terms and Candidate Files

### Search Terms Used

- `health`, `healthz`, `readyz`, `ready`, `audit`, `snapshot`
- Route patterns: `/api/health*`, `/api/ready*`, `/api/*/health*`

### Candidate Files Inventory

**Pages Router Endpoints:**
- `apps/web/src/pages/api/health.ts` - Main health endpoint
- `apps/web/src/pages/api/healthz.ts` - Liveness endpoint
- `apps/web/src/pages/api/readyz.ts` - Readiness endpoint
- `apps/web/src/pages/api/admin/readyz.ts` - Admin readiness endpoint
- `apps/web/src/pages/api/analytics/health.ts` - Analytics health endpoint
- `apps/web/pages/api/health.ts` - Legacy stub endpoint

**App Router Endpoints:**
- `apps/web/src/app/api/health/audit/route.ts` - Audit health endpoint

**Express Server:**
- `apps/web/src/server.ts` - Express `/api/health` endpoint

**Shared Readiness Logic:**
- `packages/shared/src/readiness/backendReadiness.ts` - Core readiness builder
- `packages/shared/src/health/readyChecks.ts` - Queue health checks
- `packages/shared/src/health/engineHealthSnapshot.ts` - Engine health snapshot (used by readiness)

**Tests:**
- `apps/web/test/api/health.test.ts` - Health endpoint tests
- `apps/web/test/api/readyz.test.ts` - Readiness endpoint tests
- `apps/web/test/api/admin.readyz.test.ts` - Admin readiness tests
- `test/api/healthz.test.ts` - Liveness endpoint tests
- `apps/web/test/integration/engine.flows.test.ts` - Integration tests (includes readiness checks)
- `apps/web/test/snapshot.health.test.ts` - Snapshot health test (uses `/api/analytics/health`)

**Scripts/References:**
- `scripts/verify-cron.sh` - References `/api/health/audit`
- `scripts/snapshot.ps1` - References `/api/health` (Express)
- `docs/cliply_v1_backend_launch_checklist.md` - Documents `/api/healthz` and `/api/readyz`
- `REPORTS/backend_ops_runbook.md` - Documents `/api/healthz` and `/api/readyz` usage

---

## 8. Next Steps (T2-01)

After this discovery phase, the next task (T2-01) should:

1. **Implement Phase 1** (align response shapes)
2. **Update `buildBackendReadinessReport()`** to return canonical contract fields
3. **Update endpoint handlers** to use canonical shapes
4. **Update tests** to assert canonical contracts
5. **Verify no breaking changes** (run full test suite)
6. **Document changes** in commit message and PR description

**Do NOT do in T2-01:**
- Remove any endpoints (Phase 2/3)
- Change route paths
- Modify environment variables
- Touch RLS policies or auth logic
- Change `withPlanGate` or entitlement logic

---

**End of Report**

