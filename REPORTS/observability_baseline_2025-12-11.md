# Observability Baseline – 2025-12-11

## Executive Summary

**Cliply's observability foundation**: Health/readiness endpoints for uptime monitoring, structured JSON logging with automatic secret redaction, and Sentry breadcrumbs for error tracking. The system provides multiple ways to check "is Cliply alive?" across web API, worker processes, and database connectivity, with consistent structured logging that safely handles sensitive data.

## 1. Health & Readiness Endpoints

### Web API Health Checks

#### `/api/health` (GET)
- **Purpose**: Simple binary health indicator for uptime monitoring
- **Response**: `{"ok": true}` (200) or `{"ok": false}` (503)
- **Checks**: Calls `buildBackendReadinessReport()` but only returns boolean result
- **Use case**: External uptime monitors, load balancers
- **Access**: Public (no auth required)

#### `/api/readyz` (GET)
- **Purpose**: Detailed readiness check with operational status
- **Response**: Complex JSON with checks, queue status, FFmpeg status
```json
{
  "ok": true,
  "checks": {
    "env": { "ok": true },
    "db": { "ok": true },
    "worker": { "ok": true }
  },
  "queue": {
    "length": 2,
    "oldestJobAge": 15000
  },
  "ffmpeg": {
    "ok": true
  }
}
```
- **Checks**: Environment variables, database connectivity, worker status, queue depth, FFmpeg availability
- **Use case**: Kubernetes readiness probes, internal health dashboards
- **Access**: Public (no auth required)

#### `/api/admin/readyz` (GET)
- **Purpose**: SRE-focused detailed readiness with timestamps
- **Response**: Full readiness report plus ISO timestamp
```json
{
  "ok": true,
  "checks": { /* same as /readyz */ },
  "queue": { /* same as /readyz */ },
  "ffmpeg": { /* same as /readyz */ },
  "timestamp": "2025-12-11T12:34:56.789Z"
}
```
- **Checks**: Same as `/readyz` plus timestamp for monitoring dashboards
- **Use case**: Admin dashboards, detailed monitoring systems
- **Access**: Public (no auth required, admin-level detail)

### Worker Readiness Checks

#### Worker Ready Script (`pnpm -C apps/worker readyz`)
- **Purpose**: Command-line readiness check for worker processes
- **Execution**: `apps/worker/src/readyz.ts` as Node.js script
- **Exit codes**: 0 (ready) or 1 (not ready)
- **Checks**:
  - Environment variables (worker-specific)
  - Supabase database connectivity
  - Queue table access permissions
- **Output**: JSON status report with timestamps
- **Use case**: Process managers, deployment scripts, health checks

## 2. Backend Readiness Script

### `scripts/backend.readiness.ts` (pnpm backend:readyz)

- **Purpose**: Orchestrates comprehensive readiness across web API and worker components
- **Execution**: `pnpm run backend:readyz` (used in CI)
- **Components checked**:
  - Web API readiness (via `buildBackendReadinessReport()`)
  - Worker environment and connectivity
  - Database schema integrity
  - External service availability (Stripe, FFmpeg, yt-dlp)
- **Output**: Detailed JSON report with all check results
- **Exit codes**: 0 (all systems ready) or 1 (issues detected)
- **CI integration**: Used in `backend-core` job to validate deployment readiness

## 3. Logging & Observability Hooks

### Core Logging Infrastructure

#### Structured JSON Logger (`packages/shared/logging/logger.ts`)
- **Format**: Consistent JSON output with automatic redaction
- **Fields**: `ts`, `service`, `event`, `workspaceId`, `jobId`, `message`, `error`, `meta`
- **Secret safety**: Automatic redaction of keys, tokens, secrets, passwords
- **Sampling**: Configurable sampling rate for high-volume info logs
- **Outputs**: Console (colored for development) + observer pattern for extensions

#### Specialized Observability Helpers (`packages/shared/src/observability/logging.ts`)
- **Job logging**: `logJobStatus()` with structured job lifecycle events
- **Pipeline logging**: `logPipelineStep()` for video processing stages
- **Stripe logging**: `logStripeEvent()` for webhook and billing events
- **OAuth logging**: `logOAuthEvent()` for social media connections
- **Sentry integration**: Automatic breadcrumbs when Sentry is configured

### Logging Usage Patterns

#### Web API Logging
```javascript
import { logger } from '@/lib/logger';

// API route logging
logger.info('billing_checkout_start', {
  userId,
  workspaceId,
  priceId
});

// Error logging with context
logger.error('upload_failed', {
  workspaceId,
  projectId,
  error: 'Storage quota exceeded'
});
```

#### Worker Logging
```javascript
import { logJobStatus, logPipelineStep } from '@cliply/shared/observability/logging';

// Job lifecycle
logJobStatus({
  jobId: 'job-123',
  workspaceId: 'ws-456',
  kind: 'CLIP_RENDER'
}, 'completed', {
  durationMs: 2500,
  clipId: 'clip-789'
});

// Pipeline steps
logPipelineStep({
  jobId: 'job-123',
  workspaceId: 'ws-456',
  clipId: 'clip-789'
}, 'transcribe', 'success', {
  durationMs: 1500
});
```

## 4. Proposed External Monitoring Setup

### Stage A (Current): Basic Uptime Monitoring

**Uptime Monitor Configuration:**
```bash
# Simple health check every 30 seconds
curl -f https://api.cliply.com/api/health \
  --max-time 10 \
  --retry 2 \
  --retry-delay 5
```

**Expected Response:**
- HTTP 200: `{"ok": true}`
- HTTP 503: `{"ok": false}`

**Alert Conditions:**
- 3 consecutive failures → Alert team
- Recovery notification when service returns to healthy

### Stage A (Current): Log Aggregation

**Current Logging Approach:**
- JSON logs to stdout/stderr
- Automatic Sentry breadcrumbs for errors
- Structured fields for filtering and search

**Basic Log Monitoring:**
```bash
# Search for critical errors
grep '"level":"error"' /var/log/cliply/*.log

# Find workspace-specific issues
grep '"workspaceId":"ws-123"' /var/log/cliply/*.log

# Monitor job failures
grep '"event":"job_failed"' /var/log/cliply/*.log
```

## 5. Stage A vs Stage B

### ✅ Stage A (Current): Implemented Baseline
- Health/readiness endpoints responding correctly
- Structured JSON logging with redaction
- Basic Sentry breadcrumb integration
- CI uses readiness script for deployment validation
- Worker readiness script available for process monitoring

### 🔄 Stage B (Future): Enhanced Monitoring
- **External uptime service**: UptimeRobot, Pingdom, or similar monitoring SaaS
- **Log aggregation**: ELK stack, Datadog, or CloudWatch for log indexing and search
- **Metrics collection**: Prometheus/Grafana for performance metrics
- **Alerting**: PagerDuty or Opsgenie integration for critical alerts
- **Distributed tracing**: Request correlation across web/worker boundaries
- **Enhanced readiness checks**: Queue depth thresholds, response time monitoring

## Implementation Notes

- **No runtime changes made**: This is purely documentation of existing observability features
- **Sentry integration**: Automatic when `SENTRY_DSN` environment variable is set
- **Secret redaction**: Built into logger - never logs tokens, keys, or authorization headers
- **CI integration**: `backend:readyz` script validates readiness before deployment
- **Worker monitoring**: Ready script can be used by process managers (PM2, systemd)