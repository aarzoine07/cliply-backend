# Worker Robustness Operations Runbook

## Overview

This document covers operational procedures for Cliply worker reliability features: Dead-Letter Queue (DLQ), FFmpeg safety wrappers, stuck job detection and recovery, and posting guard/usage tracking. It is intended for on-call engineers, SREs, and backend developers operating the Cliply worker in staging and production environments.

**Target audience**: On-call engineer / SRE / backend dev operating Cliply worker

---

## Key Concepts & Tables

### Jobs Table Fields

The `jobs` table tracks job lifecycle with the following key fields:

- **`state`**: Current job state. Valid values:
  - `queued`: Job is waiting to be claimed by a worker
  - `running`: Job is currently being processed by a worker
  - `done` / `completed` / `succeeded`: Job completed successfully
  - `failed` / `error`: Job failed (may be retried)
  - `dead_letter`: Job exceeded `max_attempts` and will not be retried automatically

- **`attempts`**: Number of times this job has been attempted (incremented on each failure)

- **`max_attempts`**: Maximum number of attempts before moving to DLQ (default: 5)

- **`run_at`**: Timestamp when job becomes eligible for claiming (used for backoff scheduling)

- **`locked_at`**: Timestamp when job was claimed by a worker

- **`locked_by`**: Worker ID that currently owns this job

- **`heartbeat_at`**: Most recent heartbeat timestamp from the worker processing this job

- **`error`**: JSONB field containing structured error information:
  ```json
  {
    "message": "Error message",
    "attempts": 3,
    "max_attempts": 5,
    "failed_at": "2025-01-01T12:00:00Z",
    "worker_id": "worker-123",
    "reason": "stuck_job_recovery" // optional, for stuck job recoveries
  }
  ```

- **`result`**: JSONB field containing job result (set on successful completion)

- **`workspace_id`**: UUID of the workspace that owns this job

- **`kind`**: Job type (e.g., `CLIP_RENDER`, `TRANSCRIBE`, `PUBLISH_TIKTOK`, etc.)

### Dead-Letter Queue (DLQ)

Jobs in `dead_letter` state have exceeded `max_attempts` and will not be automatically retried. They remain in the database for manual inspection and potential requeue. DLQ jobs are excluded from `worker_claim_next_job` queries.

### Job Events

The `job_events` table provides an audit trail of job lifecycle events:

- **`job_id`**: UUID reference to the job
- **`stage`**: Event stage (`enqueued`, `claimed`, `progress`, `finished`, `failed`)
- **`data`**: JSONB payload with event-specific details
- **`created_at`**: Timestamp of the event

Job events are automatically logged by:
- `worker_fail` RPC (logs `failed` events with `stage: 'dead_letter'` or `stage: 'retry_scheduled'`)
- `worker_recover_stuck_jobs` RPC (logs `failed` events with `reason: 'stuck_job_recovery'`)

---

## Dead-Letter Queue (DLQ) Behavior

### How Jobs Move to DLQ

Jobs transition to `dead_letter` state when:

1. **Normal failure path**: A job fails and `worker_fail` RPC is called. If `attempts + 1 >= max_attempts`, the job is moved to `dead_letter`.
2. **Stuck job recovery**: `worker_recover_stuck_jobs` RPC detects a stale job and if `attempts + 1 >= max_attempts`, moves it to `dead_letter`.

The `worker_fail` RPC:
- Increments `attempts` by 1
- Builds structured error payload in `error` JSONB field
- If `attempts >= max_attempts`: sets `state = 'dead_letter'`, clears locks, logs event
- Otherwise: sets `state = 'queued'`, schedules retry with backoff, logs event

### Error Storage

The `error` JSONB field contains:
- `message`: Human-readable error message
- `attempts`: Final attempt count
- `max_attempts`: Maximum attempts configured
- `failed_at`: ISO timestamp of failure
- `worker_id`: Worker that reported the failure
- `reason`: Optional reason (e.g., `"stuck_job_recovery"` for stuck jobs)

**Security note**: Error payloads do not contain API keys or secrets. Only error messages and metadata are stored.

### Inspecting DLQ Jobs

Query dead-letter jobs:

```sql
-- All DLQ jobs
SELECT id, workspace_id, kind, attempts, max_attempts, error, created_at, updated_at
FROM jobs
WHERE state = 'dead_letter'
ORDER BY updated_at DESC;

-- DLQ jobs by workspace
SELECT id, kind, attempts, error->>'message' as error_message, updated_at
FROM jobs
WHERE state = 'dead_letter' AND workspace_id = '00000000-0000-0000-0000-000000000001'
ORDER BY updated_at DESC;

-- DLQ jobs by kind
SELECT kind, COUNT(*) as count, 
       jsonb_agg(jsonb_build_object('id', id, 'workspace_id', workspace_id, 'error', error->>'message')) as jobs
FROM jobs
WHERE state = 'dead_letter'
GROUP BY kind;

-- Recent DLQ jobs with error details
SELECT id, workspace_id, kind, 
       error->>'message' as error_message,
       error->>'reason' as reason,
       attempts, max_attempts,
       updated_at
FROM jobs
WHERE state = 'dead_letter'
  AND updated_at > NOW() - INTERVAL '24 hours'
ORDER BY updated_at DESC;
```

### Requeuing DLQ Jobs

Use the `requeueDeadLetterJob` helper from `apps/worker/src/lib/jobAdmin.ts`:

**Preconditions**:
- Job must be in `dead_letter` state
- Job must exist and be accessible

**Behavior**:
- Resets `state` to `queued`
- Resets `attempts` to `0` (allows fresh retry)
- Sets `run_at` to current time (makes job immediately eligible)
- Clears `locked_at` and `locked_by`
- Updates `updated_at`
- Logs requeue event to `job_events` table

**Example usage** (TypeScript):

```typescript
import { requeueDeadLetterJob } from './apps/worker/src/lib/jobAdmin';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

await requeueDeadLetterJob({
  supabaseClient: supabase,
  jobId: 'job-uuid-here',
});
```

**Safety**: The function validates that the job is in `dead_letter` state before requeuing. Attempting to requeue a non-DLQ job will throw an error.

---

## Stuck Job Detection & Recovery

### What is a "Stuck" Job?

A stuck job is a job in `running` state where the worker's heartbeat has become stale. This typically indicates:
- Worker process crashed or was killed
- Worker lost network connectivity
- Worker is hung/blocked

A job is considered stuck if:
- `state = 'running'`
- `COALESCE(heartbeat_at, locked_at) < NOW() - INTERVAL 'stale_after_seconds seconds'`

The system uses `heartbeat_at` if available, otherwise falls back to `locked_at`.

### Worker Heartbeat RPC

The `worker_heartbeat` RPC updates `heartbeat_at` for running jobs:

**Function**: `public.worker_heartbeat(p_job_id uuid, p_worker_id text)`

**Behavior**:
- Updates `heartbeat_at = NOW()` for jobs where:
  - `id = p_job_id`
  - `locked_by = p_worker_id`
  - `state = 'running'`
- Returns the updated job row, or `NULL` if job not found/not owned by worker
- No-op (not an error) if job has completed/failed or is owned by different worker

**When called**: The worker sends heartbeats every `WORKER_HEARTBEAT_MS` (default: 5000ms / 5 seconds) while processing a job. See `apps/worker/src/worker.ts` for the heartbeat loop implementation.

### Stuck Job Recovery RPC

The `worker_recover_stuck_jobs` RPC recovers stale running jobs:

**Function**: `public.worker_recover_stuck_jobs(p_stale_after_seconds integer)`

**Behavior**:
1. Finds all jobs where:
   - `state = 'running'`
   - `COALESCE(heartbeat_at, locked_at) < NOW() - INTERVAL 'p_stale_after_seconds seconds'`

2. For each stuck job:
   - Calculates `attempts + 1` and `max_attempts`
   - Builds error payload with `reason: 'stuck_job_recovery'`
   - If `attempts + 1 >= max_attempts`:
     - Sets `state = 'dead_letter'`
     - Clears locks and heartbeat
     - Logs `job_events` entry with `stage: 'dead_letter'`, `reason: 'stuck_job_recovery_max_attempts'`
   - Otherwise:
     - Sets `state = 'queued'`
     - Increments `attempts`
     - Sets `run_at = NOW()` (immediate retry)
     - Clears locks and heartbeat
     - Logs `job_events` entry with `stage: 'retry_scheduled'`, `reason: 'stuck_job_recovery'`

3. Returns count of recovered jobs

**Logging**: All recoveries are logged to `job_events` with structured data including `stale_since`, `stale_after_seconds`, `attempts`, etc.

### Recover Stuck Jobs Script

The script `apps/worker/src/scripts/recoverStuckJobs.ts` calls the recovery RPC:

**Environment Variables**:
- `STUCK_JOB_STALE_AFTER_SECONDS`: Stale threshold in seconds (default: 900 = 15 minutes)

**How to run**:

From repo root:
```bash
# Using default (15 minutes)
pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts

# With custom stale threshold (e.g., 10 minutes)
STUCK_JOB_STALE_AFTER_SECONDS=600 pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts
```

**Output**: The script logs:
- `stuck_jobs_recover_start`: Start of recovery run
- `stuck_jobs_recovered`: Success with count of recovered jobs
- `stuck_jobs_recover_failed`: RPC error (exits with code 1)
- `stuck_jobs_recover_exception`: Unexpected exception (exits with code 1)

### Recommended Cron Schedule

Run stuck job recovery **every 5-15 minutes** in production. The exact schedule depends on your infrastructure:

- **Supabase Cron**: Configure via Supabase dashboard or SQL:
  ```sql
  SELECT cron.schedule(
    'recover-stuck-jobs',
    '*/10 * * * *', -- Every 10 minutes
    $$
    SELECT public.worker_recover_stuck_jobs(900); -- 15 minute stale threshold
    $$
  );
  ```

- **GitHub Actions / External Scheduler**: Set up a scheduled workflow/job that runs:
  ```bash
  STUCK_JOB_STALE_AFTER_SECONDS=900 pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts
  ```

**Operational practice**:
- Start with a 15-minute stale threshold (`STUCK_JOB_STALE_AFTER_SECONDS=900`)
- Run recovery every 10 minutes
- Monitor recovery counts: if consistently high, investigate worker health
- Adjust stale threshold based on typical job duration (ensure it's longer than longest expected job)

---

## FFmpeg Safety & Video URL Guardrails

### Safe FFmpeg Wrapper

The `runFfmpegSafely` function (`apps/worker/src/lib/ffmpegSafe.ts`) provides timeout enforcement and structured error handling.

**Inputs**:
- `inputPath`: Local file path for input video
- `outputPath`: Local file path for output video
- `args`: FFmpeg command-line arguments array
- `maxDurationSeconds`: Optional maximum video duration (enforced if provided)
- `timeoutMs`: Timeout in milliseconds (default: 5 minutes = 300,000ms)
- `logger`: Logger instance for structured logging

**Timeout Handling**:
- If FFmpeg runs longer than `timeoutMs`, the process is killed with `SIGKILL`
- Returns `{ ok: false, kind: 'TIMEOUT', signal: 'SIGKILL', stderrSummary: ... }`
- Logs `ffmpeg_timeout` event with `timeoutMs`, `inputPath`, `outputPath`

**Error Classification**:
- `TIMEOUT`: Process exceeded timeout (killed with SIGKILL)
- `EXIT_CODE`: FFmpeg exited with non-zero code
- `SPAWN_ERROR`: Failed to spawn FFmpeg process (e.g., binary not found)

**Logging**:
- `ffmpeg_completed`: Success with duration extracted from stderr
- `ffmpeg_failed`: Non-zero exit code with `exitCode`, `signal`, `stderrSummary`
- `ffmpeg_timeout`: Timeout exceeded
- `ffmpeg_spawn_error`: Process spawn failure
- `ffmpeg_progress`: Progress lines (filtered to avoid spam)
- `ffmpeg_duration_exceeded`: Video duration exceeds `maxDurationSeconds`

**Stderr Sanitization**: The wrapper filters stderr to remove potentially sensitive information (lines containing "password", "token", "key") and limits output to 500 characters.

### Pipeline Usage

**Clip Render Pipeline** (`apps/worker/src/pipelines/clip-render.ts`):
- Uses `runFfmpegSafely` with `timeoutMs: 10 * 60 * 1000` (10 minutes)
- Throws `FfmpegTimeoutError` on timeout
- Throws `FfmpegExecutionError` on non-zero exit code

**Thumbnail Pipeline** (`apps/worker/src/pipelines/thumbnail.ts`):
- Uses `runFfmpegSafely` with `timeoutMs: 2 * 60 * 1000` (2 minutes)
- Throws `FfmpegTimeoutError` on timeout
- Throws `FfmpegExecutionError` on non-zero exit code

### Video URL Validation

The `parseAndValidateVideoSource` function (`packages/shared/src/engine/videoInput.ts`) validates video source URLs before processing.

**Supported URL Formats**:
- **YouTube**: 
  - `https://www.youtube.com/watch?v=VIDEO_ID`
  - `https://www.youtube.com/shorts/VIDEO_ID`
  - `https://www.youtube.com/embed/VIDEO_ID`
  - `https://youtu.be/VIDEO_ID`
- **TikTok**: `https://www.tiktok.com/@user/video/...`
- **Direct URLs**: `http://` or `https://` URLs to video files

**Rejected Protocols**:
- `file://` (local file access)
- `ftp://` (FTP protocol)
- `data:` (data URIs)

**Rejected Private/Localhost Addresses**:
- `localhost`, `127.0.0.1`, `::1`
- `127.x.x.x` (any 127.x range)
- `10.x.x.x` (10.0.0.0/8 private range)
- `172.16.x.x` through `172.31.x.x` (172.16.0.0/12 private range)
- `192.168.x.x` (192.168.0.0/16 private range)

**Error Types**:
- `InvalidVideoUrlError`: Thrown for invalid/unsafe URLs
  - `url`: The rejected URL
  - `reason`: One of `"empty_url"`, `"invalid_format"`, `"unsupported_protocol"`, `"private_address"`

**Security Note**: This validation prevents FFmpeg from being called against internal/private addresses, reducing risk of SSRF (Server-Side Request Forgery) attacks. All video processing must use public HTTP/HTTPS URLs or recognized platforms (YouTube, TikTok).

---

## Posting Guard & Usage Tracking (Context)

### Posting Guard

The posting guard (`packages/shared/src/engine/postingGuard.ts`) enforces rate limits on social media posting:

- **Daily limits**: Maximum posts per day (plan-dependent: basic=10, pro=30, premium=50)
- **Minimum interval**: Minimum time between posts (plan-dependent: basic=5min, pro=2min, premium=1min)
- **Error**: `PostingLimitExceededError` thrown when limits exceeded

**Integration**: The engine validates posting limits before creating publish jobs. This is complementary to worker robustness—the guard prevents overposting at the API level, while worker robustness handles job failures and retries.

### Usage Tracker

The usage tracker (`packages/shared/src/billing/usageTracker.ts`) tracks monthly usage metrics including:

- **Posts metric**: `posts_count` tracked per workspace per month
- **Plan limits**: `posts_per_month` limits (basic=300, pro=900, premium=1500)
- **Error**: `UsageLimitExceededError` thrown when monthly limit exceeded

**Integration**: Usage is recorded when posts are successfully published. The tracker is queried before allowing new posts to ensure workspace stays within plan limits.

**Tests**: See `test/engine/postingGuard.test.ts` and `test/shared/usageTracker.posts.test.ts` for definitive behavior contracts.

---

## Common Operational Scenarios & Playbooks

### Scenario: A lot of jobs are in `dead_letter`

**Diagnosis**:
1. Query DLQ to understand scope:
   ```sql
   SELECT kind, COUNT(*) as count, 
          jsonb_agg(DISTINCT error->>'message') as error_messages
   FROM jobs
   WHERE state = 'dead_letter'
   GROUP BY kind;
   ```

2. Inspect error patterns:
   ```sql
   SELECT kind, error->>'reason' as reason, COUNT(*) as count
   FROM jobs
   WHERE state = 'dead_letter'
   GROUP BY kind, error->>'reason';
   ```

**Response**:
- **If errors are transient** (e.g., external API rate limits, temporary network issues):
  - Consider requeuing affected jobs after the issue is resolved
  - Review `max_attempts` settings—may need to increase for flaky external services
- **If errors are persistent** (e.g., invalid input, misconfiguration):
  - Investigate root cause (check `error->>'message'` for patterns)
  - Fix underlying issue (e.g., update job payloads, fix configuration)
  - Do NOT requeue until root cause is fixed
- **If errors are from stuck job recovery**:
  - Check worker health and heartbeat frequency
  - Ensure `recoverStuckJobs` script is running
  - Investigate why jobs are getting stuck

### Scenario: Jobs are getting stuck in `running` state

**Diagnosis**:
1. Check if heartbeats are being updated:
   ```sql
   SELECT COUNT(*) as stuck_count,
          AVG(EXTRACT(EPOCH FROM (NOW() - heartbeat_at))) as avg_stale_seconds
   FROM jobs
   WHERE state = 'running'
     AND heartbeat_at < NOW() - INTERVAL '5 minutes';
   ```

2. Check worker heartbeat frequency:
   - Review worker logs for `job_heartbeat_sent` events
   - Verify `WORKER_HEARTBEAT_MS` environment variable (should be ~5000ms)

3. Verify recovery script is running:
   - Check cron logs or scheduler execution history
   - Manually run recovery script and observe output

**Response**:
- **If heartbeats are not updating**:
  - Check worker process health (CPU, memory, network)
  - Verify worker can connect to Supabase
  - Check for worker crashes (review Sentry/error logs)
- **If recovery script is not running**:
  - Verify cron/scheduler configuration
  - Manually run recovery script: `STUCK_JOB_STALE_AFTER_SECONDS=900 pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts`
- **If jobs are legitimately long-running**:
  - Increase `STUCK_JOB_STALE_AFTER_SECONDS` to be longer than longest expected job
  - Consider increasing `WORKER_HEARTBEAT_MS` if heartbeats are too frequent

### Scenario: FFmpeg jobs are failing a lot

**Diagnosis**:
1. Check FFmpeg error logs:
   - Search logs for `ffmpeg_failed`, `ffmpeg_timeout`, `ffmpeg_spawn_error` events
   - Correlate with job records:
     ```sql
     SELECT id, kind, error->>'message' as error_message, updated_at
     FROM jobs
     WHERE state IN ('failed', 'dead_letter')
       AND error->>'message' LIKE '%FFmpeg%'
     ORDER BY updated_at DESC
     LIMIT 50;
     ```

2. Check for timeout patterns:
   - If many `ffmpeg_timeout` events, jobs may be legitimately taking too long
   - Review video file sizes and durations

**Response**:
- **If timeouts are common**:
  - Review video file sizes—large files may need longer timeouts
  - Consider increasing `timeoutMs` in pipeline code (clip-render: 10min, thumbnail: 2min)
  - Check worker resource limits (CPU, memory, disk I/O)
- **If spawn errors occur**:
  - Verify FFmpeg binary is installed and in PATH
  - Check worker environment setup
- **If exit code errors occur**:
  - Review `stderrSummary` in logs for FFmpeg error messages
  - Check input video file formats and codecs
  - Verify video files are not corrupted

### Scenario: Posting volume issues

**Diagnosis**:
1. Check for `PostingLimitExceededError` in logs:
   - Search for `PostingLimitExceededError` or `POSTING_LIMIT_EXCEEDED`
   - Review error context: `reason` (DAILY_LIMIT or MIN_INTERVAL), `platform`, `accountId`

2. Validate plan limits and usage:
   ```sql
   -- Check workspace plan and usage
   SELECT w.id, w.plan, u.posts_count, 
          CASE w.plan
            WHEN 'basic' THEN 300
            WHEN 'pro' THEN 900
            WHEN 'premium' THEN 1500
            ELSE 300
          END as posts_limit
   FROM workspaces w
   LEFT JOIN workspace_usage u ON u.workspace_id = w.id
   WHERE w.id = 'workspace-uuid-here';
   ```

**Response**:
- **If daily limit exceeded**:
  - Inform user they've hit daily posting limit
  - Limits are plan-dependent and enforced to prevent rate limiting by platforms
- **If monthly limit exceeded**:
  - User needs to upgrade plan or wait for next billing period
- **If minimum interval violated**:
  - User is posting too frequently
  - Limits protect against platform rate limiting

---

## How to Verify Everything is Healthy (Checklist)

### Local Testing

Run the following tests from repo root to verify implementation:

```bash
# Dead-letter queue tests
pnpm test test/worker/dead-letter-queue.test.ts

# Stuck jobs tests
pnpm test test/worker/stuck-jobs.test.ts

# FFmpeg safety tests
pnpm test test/worker/ffmpegSafe.test.ts

# Video input validation tests
pnpm test test/shared/videoInput.test.ts

# Posting guard tests
pnpm test test/engine/postingGuard.test.ts

# Usage tracker tests
pnpm test test/shared/usageTracker.posts.test.ts

# Build verification
pnpm build
```

### Staging/Production Smoke Checklist

1. **Verify stuck job recovery script**:
   ```bash
   # Run with a small stale window to test (dry-run if supported)
   STUCK_JOB_STALE_AFTER_SECONDS=60 pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts
   ```
   - Should complete without errors
   - Check logs for `stuck_jobs_recovered` event

2. **Check job state distribution**:
   ```sql
   SELECT state, COUNT(*) as count
   FROM jobs
   WHERE updated_at > NOW() - INTERVAL '24 hours'
   GROUP BY state;
   ```
   - Verify no unexpected accumulation in `dead_letter` or `running` states
   - `running` jobs should have recent `heartbeat_at` values

3. **Monitor worker heartbeat frequency**:
   - Check logs for `job_heartbeat_sent` events
   - Verify heartbeats occur every ~5 seconds for running jobs

4. **Check FFmpeg error rates**:
   - Monitor logs for `ffmpeg_failed`, `ffmpeg_timeout` events
   - Correlate with job failure rates

5. **Verify DLQ jobs are not being claimed**:
   ```sql
   -- This should return 0 (DLQ jobs should never be claimed)
   SELECT COUNT(*) 
   FROM jobs 
   WHERE state = 'dead_letter' 
     AND locked_by IS NOT NULL;
   ```

---

## Safety, Secrets, and Logging Notes

### Secrets in Logs

**Confirmed**: No secrets appear in structured logs from these features:

- **FFmpeg stderr sanitization**: The `runFfmpegSafely` wrapper filters stderr output to remove lines containing "password", "token", "key" before logging
- **Error payloads**: The `error` JSONB field in `jobs` table contains only error messages and metadata—no API keys or secrets
- **Job events**: `job_events.data` contains only job lifecycle metadata—no sensitive data

### Error Payload Safety

The `jobs.error` JSONB field stores:
- Error messages (user-facing or technical)
- Attempt counts and metadata
- Timestamps
- Worker IDs
- Recovery reasons

**No secrets stored**: API keys, tokens, passwords, or other sensitive credentials are never stored in error payloads.

### Logging Best Practices

- All structured logs use the shared logger (`@cliply/shared/logging/logger`) which includes redaction
- FFmpeg stderr is sanitized before logging
- Job payloads in logs are filtered to exclude sensitive fields (if any)

### Potential Issues (Follow-up Tasks)

If you notice any of the following during operations, create follow-up tasks:

1. **High DLQ accumulation**: If DLQ jobs accumulate rapidly, investigate root causes (external API issues, misconfiguration, etc.)
2. **Frequent stuck jobs**: If many jobs become stuck, investigate worker health, network connectivity, or job duration expectations
3. **FFmpeg timeout patterns**: If timeouts are common, consider adjusting timeout values or investigating worker resource constraints
4. **Heartbeat failures**: If `job_heartbeat_failed` events are frequent, investigate Supabase connectivity or worker performance

---

## Appendix: Quick Reference

### SQL Queries

**List all DLQ jobs**:
```sql
SELECT id, workspace_id, kind, attempts, error->>'message' as error, updated_at
FROM jobs WHERE state = 'dead_letter' ORDER BY updated_at DESC;
```

**Count stuck jobs**:
```sql
SELECT COUNT(*) FROM jobs
WHERE state = 'running' 
  AND COALESCE(heartbeat_at, locked_at) < NOW() - INTERVAL '15 minutes';
```

**Job state distribution**:
```sql
SELECT state, COUNT(*) FROM jobs GROUP BY state;
```

### Environment Variables

- `STUCK_JOB_STALE_AFTER_SECONDS`: Stale threshold for stuck job recovery (default: 900)
- `WORKER_HEARTBEAT_MS`: Heartbeat interval in milliseconds (default: 5000)
- `WORKER_POLL_MS`: Job polling interval in milliseconds (default: 1000)

### Script Commands

**Recover stuck jobs**:
```bash
STUCK_JOB_STALE_AFTER_SECONDS=900 pnpm tsx apps/worker/src/scripts/recoverStuckJobs.ts
```

**Run worker**:
```bash
pnpm worker
```

---

*Last updated: 2025-01-08*

