# Job Debugging Runbook

**Purpose:** How to debug stuck, slow, or failing jobs

**Last Updated:** 2025-12-08

---

## When to Use This Runbook

Use this runbook when:

- Jobs are stuck in `running` state for too long
- Queue depth is growing (pending jobs piling up)
- Jobs are failing but not in DLQ yet
- Single job needs investigation
- Alerts indicate job processing issues

---

## Symptoms & Signals

### High Pending Queue Depth

**Symptom:**
```bash
pnpm jobs:stats
# Shows: Pending: 500+ jobs
```

**Possible causes:**
- No active workers (workers crashed/not deployed)
- Workers saturated (too many long-running jobs)
- Database connection issues preventing job claims

### Jobs Stuck in `running` State

**Symptom:**
```bash
pnpm jobs:status <jobId>
# Shows: State: running, Heartbeat: 30m ago
```

**Possible causes:**
- Worker crashed mid-job
- Infinite loop in job handler
- Network issue preventing heartbeat updates
- Job legitimately taking a long time

### Spike in Failed/Dead-Letter Jobs

**Symptom:**
```bash
pnpm jobs:stats
# Shows: Dead-Letter: 50+ jobs (normally < 10)
```

**Possible causes:**
- Underlying bug introduced in recent deployment
- Infrastructure issue (FFmpeg missing, storage unavailable)
- Invalid data in job payloads

---

## Initial Checks

### Step 1: Check Overall Engine Health

```bash
pnpm jobs:stats
```

**Review:**
- Overall health (`ok` flag)
- Queue depths (pending, running, dead-letter)
- Active worker count
- Recent errors
- FFmpeg/yt-dlp availability

**Key metrics:**
- `Pending`: Should be < 100 under normal load
- `Running`: Should roughly match active worker count (1-10 jobs per worker)
- `Dead-Letter`: Should be < 10 under normal operation
- `Active Workers`: Should be > 0 (typically 1-5)

### Step 2: Check Worker Status

```bash
pnpm workers:status
```

**Review:**
- Active worker count
- Last heartbeat timestamp
- Binary availability

**Red flags:**
- Active workers = 0 (no workers running!)
- Last heartbeat > 10 minutes ago (workers may be stuck)
- FFmpeg not available (video jobs will fail)

### Step 3: Review Recent Errors

```bash
pnpm dlq:list --limit=10
```

**Look for:**
- Common error patterns
- Specific job kind(s) failing
- Error messages that indicate root cause

---

## Investigate Specific Job

When a specific job is reported as problematic:

### Step 1: Get Job Status

```bash
pnpm jobs:status <jobId>
```

**Key info to extract:**
- Current state
- Number of attempts
- Timestamps (created, updated, locked, heartbeat)
- Error details (if any)
- Payload (to understand what job is trying to do)

### Step 2: Interpret Job State

#### State: `queued` or `pending`

**Meaning:** Job is waiting to be claimed by a worker

**Troubleshooting:**
1. Check if workers are active:
   ```bash
   pnpm workers:status
   ```
2. Check queue depth (is queue backed up?):
   ```bash
   pnpm jobs:stats
   ```
3. Check `run_at` timestamp (is job scheduled for future?)

**Normal:** Job should transition to `running` within 1-5 minutes under normal load

**Abnormal:** Job queued for > 1 hour → Worker availability issue or queue backlog

#### State: `running` or `processing`

**Meaning:** Job is currently being processed by a worker

**Troubleshooting:**
1. Check heartbeat timestamp:
   ```bash
   pnpm jobs:status <jobId>
   ```
   - Heartbeat < 5 minutes old: Job is actively being processed ✅
   - Heartbeat > 10 minutes old: Worker may have crashed ⚠️

2. Check job duration:
   - Calculate: `now - locked_at`
   - Normal: < 10 minutes for most jobs
   - Long: 10-30 minutes for large transcriptions
   - Too long: > 30 minutes → Investigate

3. Check worker logs for job ID (if available)

**Normal:** Job should complete within expected duration (varies by kind)

**Abnormal:** Job running for hours with stale heartbeat → Stuck job

#### State: `failed`

**Meaning:** Job failed but has not exhausted retries yet

**Troubleshooting:**
1. Check error message:
   ```bash
   pnpm jobs:status <jobId>
   ```
2. Check attempts:
   - `1-2 attempts`: May succeed on retry (transient error)
   - `4-5 attempts`: Likely to go to DLQ soon
3. Check if error is transient or persistent

**Normal:** Some transient failures (network blips) are expected

**Abnormal:** Same job failing repeatedly with same error → Persistent issue

#### State: `dead_letter`

**Meaning:** Job exhausted all retries and is in DLQ

**Troubleshooting:**
1. Use DLQ inspection:
   ```bash
   pnpm dlq:inspect <jobId>
   ```
2. See [DLQ Recovery Runbook](./DLQ-recovery.md)

#### State: `done`, `completed`, `succeeded`

**Meaning:** Job completed successfully ✅

**If reported as problematic:**
- Job may have succeeded after retries (check attempts count)
- User may be confused about state
- Double-check output/results are actually present

### Step 3: Check Job Events (If Available)

If `job_events` table exists:

```bash
pnpm jobs:status <jobId>
# Shows recent events at bottom
```

**Look for:**
- Event timeline (when did key transitions happen?)
- Repeated failure patterns
- Long gaps between events (indicates stalls)

---

## Next Actions

Based on investigation findings, choose appropriate action:

### Action 1: Wait for Job to Complete

**When:**
- Job is actively running (recent heartbeat)
- Job duration is within expected range
- No error indicators

**What to do:**
- Monitor with `pnpm jobs:status <jobId>` every few minutes
- Set a timeout (e.g., if not done in 30 minutes, escalate)

### Action 2: Requeue from DLQ

**When:**
- Job is in `dead_letter` state
- Root cause identified and fixed
- Safe to retry

**What to do:**
1. See [DLQ Recovery Runbook](./DLQ-recovery.md)
2. Execute:
   ```bash
   pnpm dlq:requeue <jobId>
   ```

### Action 3: Cancel/Delete Job

**When:**
- Job has invalid payload (will never succeed)
- User requested cancellation
- Job is obsolete

**What to do:**
1. Manually update job state in database:
   ```sql
   UPDATE jobs
   SET state = 'cancelled',
       locked_at = NULL,
       locked_by = NULL,
       updated_at = NOW()
   WHERE id = '<jobId>';
   ```
2. ⚠️ **Caution:** Only do this if certain job should not complete

### Action 4: Reclaim Stuck Jobs

**When:**
- Many jobs stuck in `running` with stale heartbeats
- Worker crashed or was forcibly terminated

**What to do:**
1. Stuck jobs are automatically reclaimed by `worker_recover_stuck_jobs` RPC
2. Check if reclaim is working:
   ```bash
   # Wait 15 minutes, then check
   pnpm jobs:status <jobId>
   # If still stuck, RPC may not be running
   ```
3. Manual reclaim (if RPC not working):
   ```sql
   -- Reclaim jobs with heartbeat > 15 minutes old
   UPDATE jobs
   SET state = 'queued',
       locked_at = NULL,
       locked_by = NULL,
       run_at = NOW(),
       updated_at = NOW()
   WHERE state IN ('running', 'processing')
     AND heartbeat_at < NOW() - INTERVAL '15 minutes';
   ```

### Action 5: Escalate to Engineering

**When:**
- Root cause unclear after investigation
- Systematic failures across many jobs
- Infrastructure issue suspected
- Bug fix required

**Escalation details:**
- Output of `pnpm jobs:stats`
- Output of `pnpm jobs:status <jobId>` for affected jobs
- Error messages and patterns
- Timeline of when issue started
- Recent deployments or changes

---

## Common Scenarios & Solutions

### Scenario 1: Queue Backed Up (High Pending Count)

**Symptoms:**
```bash
pnpm jobs:stats
# Pending: 500+, Active Workers: 0
```

**Root cause:** No workers running

**Solution:**
1. Check worker deployment status
2. Restart worker container/process
3. See [Worker Debugging Runbook](./worker-debugging.md)

---

### Scenario 2: Job Stuck in Running (Stale Heartbeat)

**Symptoms:**
```bash
pnpm jobs:status <jobId>
# State: running, Heartbeat: 45m ago
```

**Root cause:** Worker crashed mid-job

**Solution:**
1. Wait for automatic reclaim (runs every 10 minutes)
2. Or manually reclaim (see Action 4 above)
3. Check worker logs for crash reason

---

### Scenario 3: Jobs Failing with FFmpeg Errors

**Symptoms:**
```bash
pnpm dlq:list --kind=TRANSCRIBE
# Multiple failures with "FFmpeg timeout" or "ffmpeg: command not found"
```

**Root cause:** FFmpeg not available or misconfigured

**Solution:**
1. Check binary availability:
   ```bash
   pnpm workers:status
   # Should show: FFmpeg: ✅ Available
   ```
2. If not available:
   - Install FFmpeg in worker environment
   - Verify PATH includes FFmpeg
   - Restart workers
3. Requeue affected jobs after fix

---

### Scenario 4: Jobs Failing with "Source File Not Found"

**Symptoms:**
```bash
pnpm jobs:status <jobId>
# Error: ENOENT: no such file or directory
```

**Root cause:** 
- File was deleted from storage
- Incorrect storage path
- Timing issue (file not yet uploaded)

**Solution:**
1. Check if file exists in storage bucket:
   - Use Supabase storage dashboard
   - Or CLI: check `workspace_id/project_id/source.*`
2. If missing:
   - Job cannot succeed (delete or cancel)
   - Investigate why file is missing (bug?)
3. If path is wrong:
   - Fix code bug
   - Requeue after deploy

---

### Scenario 5: Jobs Succeed But Take Very Long

**Symptoms:**
```bash
pnpm jobs:status <jobId>
# State: completed, Duration: 25 minutes
```

**Root cause:**
- Large video files
- Slow worker resources
- Inefficient processing

**Solution:**
1. Review job payload (video duration, size)
2. Check if duration is reasonable for input size
3. If consistently slow:
   - Scale up worker resources (CPU/memory)
   - Optimize processing code
   - Consider job parallelization

---

## Logging & Sentry Integration

### Sentry Error Tracking

Jobs that fail with exceptions should be logged to Sentry:

1. Search Sentry for job ID
2. Look for error context (job kind, workspace, payload snippet)
3. Check error frequency (one-off or systematic?)
4. Review stack trace for code issue

**Sentry search:**
```
job_id:<jobId>
kind:TRANSCRIBE
environment:production
```

### Worker Logs

If workers log to structured logging system:

1. Search logs for job ID
2. Look for error messages, stack traces
3. Check for heartbeat updates
4. Review processing duration

**Example log query:**
```
job_id:"<jobId>" AND service:"worker"
```

---

## Monitoring & Alerts

### Key Metrics to Monitor

1. **Queue Depth:**
   - Alert if `pending > 100` for > 15 minutes
   - Alert if `running > 50` (may indicate stuck jobs)

2. **DLQ Count:**
   - Alert if `dead_letter > 20`
   - Alert if DLQ growing > 10 jobs/hour

3. **Worker Count:**
   - Alert if `active_workers = 0` for > 5 minutes

4. **Job Success Rate:**
   - Alert if success rate < 90% over 1 hour window

### Recommended Alert Rules

```yaml
# Example alert configuration (Prometheus/Grafana)

- alert: HighQueueDepth
  expr: cliply_jobs_pending > 100
  for: 15m
  annotations:
    summary: "High pending job queue depth"
    runbook: "REPORTS/runbooks/job-debugging.md"

- alert: NoActiveWorkers
  expr: cliply_workers_active == 0
  for: 5m
  annotations:
    summary: "No active workers detected"
    runbook: "REPORTS/runbooks/worker-debugging.md"

- alert: HighDLQCount
  expr: cliply_jobs_dead_letter > 20
  for: 10m
  annotations:
    summary: "High dead-letter queue count"
    runbook: "REPORTS/runbooks/DLQ-recovery.md"
```

---

## Related Runbooks

- [DLQ Recovery](./DLQ-recovery.md) — How to recover dead-letter jobs
- [Worker Debugging](./worker-debugging.md) — How to debug worker availability

## Related Commands

```bash
# Investigation
pnpm jobs:stats                 # Overall queue health
pnpm jobs:status <jobId>        # Specific job status
pnpm workers:status             # Worker availability
pnpm dlq:list                   # List dead-letter jobs

# Recovery
pnpm dlq:requeue <jobId>        # Requeue DLQ job

# Monitoring
pnpm backend:readyz             # Full backend readiness
```

---

**Last Updated:** 2025-12-08  
**Maintained By:** Engineering Team  
**Feedback:** Report issues or improvements in team Slack

