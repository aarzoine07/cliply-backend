# Worker Debugging Runbook

**Purpose:** How to debug worker availability and performance issues

**Last Updated:** 2025-12-08

---

## When to Use This Runbook

Use this runbook when:

- No jobs are being processed (queue backing up)
- Worker count is zero or very low
- Workers are running but not claiming jobs
- High rate of worker crashes
- Workers are slow or unresponsive

---

## Symptoms

### No Jobs Being Processed

**Symptom:**
```bash
pnpm workers:status
# Shows: Active Workers: 0
```

**Impact:**
- Pending jobs pile up
- No progress on any pipeline stage
- System appears "frozen"

### High Queue Depth, Zero Active Workers

**Symptom:**
```bash
pnpm jobs:stats
# Pending: 500+, Active Workers: 0
```

**Impact:**
- Jobs queued but never claimed
- User-facing delays
- SLA violations

### Workers Present But Jobs Stuck

**Symptom:**
```bash
pnpm workers:status
# Active Workers: 2, Last Heartbeat: 45m ago
```

**Impact:**
- Workers alive but not processing
- Jobs stuck in `running` state
- Unclear if workers are healthy

---

## Initial Checks

### Step 1: Check Worker Status

```bash
pnpm workers:status
```

**Key metrics:**
- **Active Workers:** Should be > 0 (typically 1-5 depending on deployment)
- **Last Heartbeat:** Should be < 5 minutes ago
- **FFmpeg/yt-dlp:** Should show "✅ Available"

**Interpretation:**

| Active Workers | Last Heartbeat | Status |
|----------------|----------------|--------|
| 0 | N/A | ❌ No workers running |
| 1+ | < 5m ago | ✅ Healthy |
| 1+ | > 10m ago | ⚠️ Workers stuck |

### Step 2: Check Overall Queue Health

```bash
pnpm jobs:stats
```

**Key metrics:**
- **Pending:** How many jobs are waiting?
- **Running:** How many jobs are being processed?
- **Dead-Letter:** Are jobs failing?

**Red flags:**
- Pending > 100 + Active Workers = 0 → Workers not running
- Running > 0 + Stale heartbeats → Workers crashed mid-job
- Dead-Letter spiking → Worker environment issues

### Step 3: Check Binary Availability

```bash
pnpm workers:status
# Look for FFmpeg and yt-dlp status
```

**If FFmpeg shows "❌ Not found":**
- Video processing jobs will fail
- Worker environment is misconfigured

**If yt-dlp shows "❌ Not found":**
- YouTube download jobs will fail
- Not critical if you don't use YouTube downloads

---

## Diagnostics by Scenario

### Scenario 1: No Workers Running (Active Workers = 0)

**Root causes:**
1. Worker container/process not deployed
2. Worker failed to start (startup error)
3. Worker deployment scaled to 0
4. All workers crashed

**Diagnostic steps:**

#### 1.1. Check Worker Deployment Status

**Docker:**
```bash
docker ps | grep worker
# Should show at least one running container
```

**Kubernetes:**
```bash
kubectl get pods -l app=worker
# Should show at least one pod in Running state
```

**Systemd:**
```bash
systemctl status cliply-worker
# Should show "active (running)"
```

#### 1.2. Check Worker Startup Logs

**Docker:**
```bash
docker logs <worker-container-id> | tail -50
```

**Kubernetes:**
```bash
kubectl logs -l app=worker --tail=50
```

**Common startup errors:**
- `SUPABASE_URL is not configured` → Missing env var
- `FFmpeg not found` → Missing binary
- `Cannot connect to database` → Network/credentials issue
- Uncaught exception → Code bug

#### 1.3. Verify Environment Variables

```bash
# From worker deployment/pod
pnpm check:env
# Or manually check:
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY
```

**Required env vars:**
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

**Optional but recommended:**
- `SENTRY_DSN` (for error tracking)
- `LOG_LEVEL` (for debugging)

#### 1.4. Check Worker Readiness

If worker container is running:

```bash
# Inside worker container/pod
pnpm backend:readyz
```

**Expected output:**
```json
{
  "ok": true,
  "ffmpegOk": true,
  "ytDlpOk": true,
  "database": "ok",
  ...
}
```

**If `ok: false`:**
- Review specific failures
- Fix environment issues
- Restart worker

---

### Scenario 2: Workers Running But Not Claiming Jobs

**Symptoms:**
- Active Workers > 0
- Pending jobs > 0
- But jobs never transition to `running`

**Root causes:**
1. Database connection issue (can't query jobs)
2. Job claim query returning empty (bug)
3. Worker stuck in infinite loop
4. Jobs have future `run_at` (scheduled)

**Diagnostic steps:**

#### 2.1. Check Worker Logs

Look for:
- Job claim attempts: `worker_claim_next_job`
- Database errors
- Uncaught exceptions
- Infinite loop indicators (same log repeated)

**Healthy worker logs:**
```
[INFO] Polling for jobs...
[INFO] Claimed job abc123 (kind: TRANSCRIBE)
[INFO] Job abc123 started
[INFO] Heartbeat sent for job abc123
[INFO] Job abc123 completed
```

**Unhealthy worker logs:**
```
[ERROR] Failed to query jobs: connection refused
# Or no logs at all (stuck)
```

#### 2.2. Check Database Connectivity

From worker environment:

```bash
# Test database connection
psql $DATABASE_URL -c "SELECT COUNT(*) FROM jobs WHERE state = 'queued';"
```

**If connection fails:**
- Network issue (firewall, DNS)
- Credentials wrong
- Database down

#### 2.3. Check `run_at` Timestamps

```sql
SELECT id, kind, state, run_at, created_at
FROM jobs
WHERE state = 'queued'
ORDER BY run_at ASC
LIMIT 10;
```

**If `run_at` is in the future:**
- Jobs are scheduled, not immediately runnable
- Normal behavior for retries with backoff

**If `run_at` is in the past:**
- Jobs should be claimable
- Worker should be picking them up

---

### Scenario 3: Workers Stuck (Stale Heartbeats)

**Symptoms:**
- Active Workers > 0
- Last Heartbeat > 10 minutes ago
- Jobs stuck in `running` state

**Root causes:**
1. Worker process hung/deadlocked
2. Infinite loop in job handler
3. Network issue preventing heartbeat updates
4. Worker resource exhaustion (CPU/memory)

**Diagnostic steps:**

#### 3.1. Check Worker Resource Usage

**Docker:**
```bash
docker stats <worker-container-id>
```

**Kubernetes:**
```bash
kubectl top pod -l app=worker
```

**Look for:**
- CPU at 100% (infinite loop or heavy processing)
- Memory near limit (memory leak or large files)
- High I/O wait (slow disk)

#### 3.2. Check Worker Logs

Look for:
- Last log timestamp (is worker logging at all?)
- Repeated errors
- Stack traces
- Job ID of stuck job

#### 3.3. Restart Stuck Workers

**Docker:**
```bash
docker restart <worker-container-id>
```

**Kubernetes:**
```bash
kubectl delete pod -l app=worker
# Deployment will recreate pods
```

**Systemd:**
```bash
systemctl restart cliply-worker
```

**After restart:**
1. Check worker status:
   ```bash
   pnpm workers:status
   ```
2. Verify jobs start processing again
3. Monitor for recurrence

---

### Scenario 4: Workers Crashing Frequently

**Symptoms:**
- Worker count fluctuates (0 → 1 → 0)
- Container restart count increasing
- Jobs start then immediately fail

**Root causes:**
1. Uncaught exception in job handler
2. Out of memory (OOM)
3. Segfault in FFmpeg or native dependency
4. Invalid job payload causing crash

**Diagnostic steps:**

#### 4.1. Check Crash Logs

**Docker:**
```bash
docker logs <worker-container-id> | grep -i "error\|exception\|fatal"
```

**Kubernetes:**
```bash
kubectl logs -l app=worker --previous
# Shows logs from crashed pod
```

**Common crash patterns:**
- `JavaScript heap out of memory` → OOM
- `Segmentation fault` → Native crash (FFmpeg?)
- `Unhandled promise rejection` → Async error

#### 4.2. Identify Problematic Jobs

If crash is job-specific:

```bash
# Check recent failed jobs
pnpm dlq:list --limit=10
```

Look for:
- Same job kind crashing repeatedly
- Specific payload pattern
- Large files or unusual input

**Action:**
1. Fix job handler bug
2. Deploy fix
3. Optionally move bad jobs to DLQ manually

#### 4.3. Increase Worker Resources

If OOM crashes:

**Docker Compose:**
```yaml
services:
  worker:
    mem_limit: 2g  # Increase from 1g
    mem_reservation: 1g
```

**Kubernetes:**
```yaml
resources:
  limits:
    memory: "2Gi"  # Increase from 1Gi
  requests:
    memory: "1Gi"
```

---

### Scenario 5: FFmpeg Not Available

**Symptoms:**
```bash
pnpm workers:status
# FFmpeg: ❌ Not found
```

**Impact:**
- All video processing jobs will fail
- TRANSCRIBE, CLIP_RENDER, THUMBNAIL_GEN jobs go to DLQ

**Root causes:**
1. FFmpeg not installed in worker image
2. FFmpeg not in PATH
3. Wrong FFmpeg binary name

**Diagnostic steps:**

#### 5.1. Check FFmpeg Installation

From worker container/pod:

```bash
which ffmpeg
# Should output: /usr/bin/ffmpeg or similar

ffmpeg -version
# Should show version info
```

**If not found:**
- Install FFmpeg in Dockerfile
- Or add to PATH

#### 5.2. Fix Dockerfile

Example fix:

```dockerfile
# Add FFmpeg installation
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    rm -rf /var/lib/apt/lists/*
```

#### 5.3. Rebuild and Redeploy

```bash
# Rebuild worker image
docker build -t cliply-worker:latest ./apps/worker

# Push to registry (if using one)
docker push cliply-worker:latest

# Restart workers with new image
docker-compose up -d worker
# Or kubectl rollout restart deployment worker
```

#### 5.4. Verify Fix

```bash
pnpm workers:status
# Should now show: FFmpeg: ✅ Available
```

---

## Remediation Steps

### Quick Fixes (< 5 minutes)

1. **Restart workers** (if stuck or crashed):
   ```bash
   # Docker
   docker restart $(docker ps -q -f name=worker)
   
   # Kubernetes
   kubectl rollout restart deployment worker
   ```

2. **Scale up workers** (if overwhelmed):
   ```bash
   # Docker Compose
   docker-compose up -d --scale worker=3
   
   # Kubernetes
   kubectl scale deployment worker --replicas=3
   ```

3. **Check and fix env vars** (if missing):
   - Update `.env` or deployment config
   - Restart workers

### Medium Fixes (5-30 minutes)

1. **Install missing binaries** (FFmpeg, yt-dlp):
   - Update Dockerfile
   - Rebuild image
   - Redeploy

2. **Fix database connectivity**:
   - Verify network/firewall rules
   - Check credentials
   - Test connection manually

3. **Increase resources** (if OOM):
   - Update resource limits
   - Redeploy with new limits

### Long-term Fixes (> 30 minutes)

1. **Debug and fix code bugs**:
   - Reproduce crash locally
   - Add error handling
   - Deploy fix

2. **Optimize job handlers**:
   - Profile slow jobs
   - Reduce memory usage
   - Add timeouts

3. **Set up monitoring**:
   - Prometheus metrics
   - Grafana dashboards
   - Alerting rules

---

## Common Causes & Solutions

### Cause: Missing Environment Variables

**Symptoms:**
- Worker fails to start
- Error: `SUPABASE_URL is not configured`

**Solution:**
1. Check env file or deployment config
2. Add missing variables:
   ```bash
   SUPABASE_URL=https://xxx.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJ...
   ```
3. Restart workers

---

### Cause: Database Connection Refused

**Symptoms:**
- Worker starts but can't query jobs
- Error: `connection refused` or `ECONNREFUSED`

**Solution:**
1. Verify database URL is correct
2. Check firewall/security groups
3. Test connection manually:
   ```bash
   psql $DATABASE_URL -c "SELECT 1;"
   ```
4. If Supabase, check if IP is whitelisted

---

### Cause: Worker Out of Memory

**Symptoms:**
- Worker crashes with `JavaScript heap out of memory`
- Container OOM killed

**Solution:**
1. Increase memory limit:
   ```yaml
   # docker-compose.yml
   mem_limit: 2g
   ```
2. Optimize memory usage in code
3. Process smaller files or add pagination

---

### Cause: FFmpeg Missing

**Symptoms:**
- Video jobs fail with `ffmpeg: command not found`
- `pnpm workers:status` shows FFmpeg ❌

**Solution:**
1. Add FFmpeg to Dockerfile:
   ```dockerfile
   RUN apt-get update && apt-get install -y ffmpeg
   ```
2. Rebuild and redeploy
3. Verify: `pnpm workers:status`

---

### Cause: Worker Deployment Scaled to Zero

**Symptoms:**
- No workers running
- No recent worker logs

**Solution:**
1. Check deployment scale:
   ```bash
   # Kubernetes
   kubectl get deployment worker
   # Should show READY > 0
   ```
2. Scale up:
   ```bash
   kubectl scale deployment worker --replicas=2
   ```

---

## When to Escalate

Escalate to engineering if:

- ❌ Workers crash immediately on startup (after env/resource fixes)
- ❌ Workers claim jobs but crash on every job
- ❌ Database connection issues persist after network/credentials verified
- ❌ Worker logs show code bugs or segfaults
- ❌ No clear root cause after following all diagnostic steps

**Escalation details to include:**
- Output of `pnpm workers:status`
- Output of `pnpm jobs:stats`
- Worker logs (last 100 lines)
- Deployment configuration (Dockerfile, k8s manifests)
- Recent deployments or infrastructure changes

---

## Monitoring & Alerts

### Key Metrics

1. **Worker Count:**
   ```
   cliply_workers_active
   ```
   - Alert if == 0 for > 5 minutes

2. **Worker Heartbeat Age:**
   ```
   time() - cliply_workers_last_heartbeat_timestamp
   ```
   - Alert if > 600 seconds (10 minutes)

3. **Worker Restart Count:**
   ```
   rate(kube_pod_container_status_restarts_total{container="worker"}[5m])
   ```
   - Alert if > 3 restarts in 5 minutes

### Recommended Alerts

```yaml
# Example Prometheus alert rules

- alert: NoActiveWorkers
  expr: cliply_workers_active == 0
  for: 5m
  annotations:
    summary: "No active Cliply workers"
    description: "Worker count has been 0 for 5 minutes"
    runbook: "REPORTS/runbooks/worker-debugging.md"

- alert: WorkerHeartbeatStale
  expr: (time() - cliply_workers_last_heartbeat_timestamp) > 600
  for: 5m
  annotations:
    summary: "Worker heartbeat is stale"
    description: "No worker heartbeat for > 10 minutes"
    runbook: "REPORTS/runbooks/worker-debugging.md"

- alert: WorkerCrashLoop
  expr: rate(kube_pod_container_status_restarts_total{container="worker"}[5m]) > 0.5
  for: 5m
  annotations:
    summary: "Worker crash loop detected"
    description: "Worker container restarting frequently"
    runbook: "REPORTS/runbooks/worker-debugging.md"
```

---

## Related Runbooks

- [Job Debugging](./job-debugging.md) — How to debug stuck or failing jobs
- [DLQ Recovery](./DLQ-recovery.md) — How to recover dead-letter jobs

## Related Commands

```bash
# Worker status
pnpm workers:status             # Worker activity and health
pnpm backend:readyz             # Full readiness check

# Queue status
pnpm jobs:stats                 # Overall queue health

# Job debugging
pnpm jobs:status <jobId>        # Specific job status
pnpm dlq:list                   # List dead-letter jobs
```

---

**Last Updated:** 2025-12-08  
**Maintained By:** Engineering Team  
**Feedback:** Report issues or improvements in team Slack

