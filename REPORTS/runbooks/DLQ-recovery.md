# Dead-Letter Queue (DLQ) Recovery Runbook

**Purpose:** How to inspect and recover dead_letter jobs safely

**Last Updated:** 2025-12-08

---

## When to Use This Runbook

Use this runbook when:

- Jobs are accumulating in the dead-letter queue (DLQ)
- You need to understand why jobs failed after max attempts
- You want to safely requeue jobs after fixing the root cause
- Alerts indicate high DLQ job count

## Overview

The dead-letter queue (DLQ) is a safety mechanism that prevents infinite retry loops. Jobs enter the DLQ when they exceed `max_attempts` (typically 5 retries). Once in DLQ, jobs are **permanently stopped** unless manually requeued.

**Key Principles:**
- ✅ Always understand the error before requeuing
- ✅ Deploy fixes before requeuing
- ✅ Requeue selectively, not in bulk
- ❌ Never requeue without investigating first
- ❌ Don't requeue the same job multiple times if it keeps failing

---

## Pre-Checks

Before recovering DLQ jobs, perform these checks:

### 1. Review Engine Health

```bash
pnpm jobs:stats
```

**Check for:**
- Overall health status (`ok` flag)
- DLQ count (high = systemic issue)
- Recent error patterns
- Worker availability

### 2. Identify Root Cause

```bash
pnpm dlq:list --limit=20
```

**Look for:**
- Common error patterns across jobs
- Specific job kind(s) affected
- Time pattern (all from same time window?)

**Example patterns:**
- `FFmpeg timeout` → Video too long or FFmpeg config issue
- `ENOENT: no such file` → Storage path issue
- `Invalid credentials` → API key expired
- `Database connection` → Transient infrastructure issue

### 3. Inspect Sample Jobs

Pick 2-3 representative jobs:

```bash
pnpm dlq:inspect <jobId>
```

**Review:**
- Error message (structured + text)
- Payload (is input valid?)
- Timestamps (when did it fail?)
- Attempts history

---

## Step-by-Step DLQ Inspection

### Step 1: List DLQ Jobs

```bash
# All DLQ jobs (default: 50)
pnpm dlq:list

# More jobs
pnpm dlq:list --limit=100

# Filter by job kind
pnpm dlq:list --kind=TRANSCRIBE
pnpm dlq:list --kind=CLIP_RENDER
```

**Output Example:**
```
📋 Dead-Letter Queue (12 jobs)

ID          Kind                  Workspace   Attempts   Updated         Error
──────────────────────────────────────────────────────────────────────────────
abc123…     TRANSCRIBE            ws-xyz…     5/5        2h ago          FFmpeg timeout
def456…     CLIP_RENDER           ws-xyz…     5/5        3h ago          Source file not found
```

### Step 2: Inspect Individual Jobs

```bash
pnpm dlq:inspect <jobId>
```

**What to look for:**

**Error Details:**
- Is the error message clear?
- Is it a code bug or infrastructure issue?
- Is the payload/input valid?

**Timestamps:**
- When did it first fail?
- How long between attempts?
- Is it correlated with a deployment or incident?

**Job Kind:**
- Is this a known fragile pipeline?
- Does the error match the job type?

### Step 3: Correlate with Logs

If available, check:
- Sentry errors for the time window
- Worker container logs
- Database/infrastructure alerts

**Sentry:**
- Look for job ID in error context
- Check for similar errors in same time window

**Worker Logs:**
- Search for job ID
- Look for stack traces

---

## Requeue Strategy

### When It's Safe to Requeue

✅ **Safe scenarios:**
1. **Transient infrastructure failure** (e.g., database connection blip, fixed)
2. **Deployed bug fix** (e.g., code bug causing failures, now patched)
3. **Configuration fix** (e.g., updated API credentials, env vars)
4. **One-off anomaly** (e.g., corrupted input, only affects single job)

❌ **Unsafe scenarios:**
1. **Root cause unknown** → Will likely fail again
2. **Bug still present** → Will immediately return to DLQ
3. **Invalid input data** → Job will never succeed with current payload
4. **Systemic issue ongoing** → Will overload queue

### Requeue Process

#### 1. Requeue Single Job

```bash
pnpm dlq:requeue <jobId>
```

**Expected output:**
```
🔄 Requeuing job: abc123-def456-789012...
✅ Successfully requeued job abc123-def456-789012

   State:    dead_letter → queued
   Attempts: reset to 0
   Run At:   now (eligible for immediate processing)

💡 Next steps:
   pnpm jobs:status abc123-def456-789012   Monitor job status
   pnpm jobs:stats                         Check overall queue health
```

#### 2. Monitor Requeued Job

**Immediately after requeue:**
```bash
pnpm jobs:status <jobId>
```

**Check:**
- State changed from `dead_letter` to `queued`?
- Attempts reset to `0`?

**After a few minutes:**
```bash
pnpm jobs:status <jobId>
```

**Check:**
- Is it `running` or `completed`?
- Or is it back in `failed`/`dead_letter`?

#### 3. Requeue Multiple Jobs (With Caution)

**⚠️  WARNING:** Only requeue multiple jobs if:
- You've confirmed root cause is fixed
- You've successfully requeued and verified 1-2 test jobs
- Jobs are not too numerous (< 50 at a time)

**Manual batch requeue:**
```bash
# Get job IDs (adjust --limit as needed)
pnpm dlq:list --kind=TRANSCRIBE --limit=10

# Requeue each one individually (no bulk operation yet)
pnpm dlq:requeue <jobId1>
pnpm dlq:requeue <jobId2>
# ... etc
```

**Future:** Bulk requeue helper (not yet implemented)

---

## Post-Requeue Verification

### 1. Immediate Check (0-5 minutes)

```bash
# Check if job is being processed
pnpm jobs:status <jobId>
```

**Expected states:**
- `queued` → Waiting for worker
- `running` → Being processed ✅
- `failed` → Uh oh, still failing ❌

### 2. Short-term Check (5-30 minutes)

```bash
# Check overall queue health
pnpm jobs:stats
```

**Watch for:**
- Is the requeued job completed?
- Are new jobs entering DLQ at a high rate?
- Is queue depth growing?

### 3. Long-term Monitoring (1+ hours)

```bash
# Check DLQ again
pnpm dlq:list
```

**Success indicators:**
- DLQ count is stable or decreasing
- Requeued jobs show `completed` or `succeeded` state
- No new similar errors in DLQ

**Failure indicators:**
- Jobs immediately return to DLQ
- DLQ count growing faster than before
- Same error message repeating

---

## Safety Notes

### ⚠️  Do Not Bulk Requeue Blindly

**Why:**
- If root cause isn't fixed, you'll just spam the queue
- Can overload workers and delay legitimate new jobs
- Makes debugging harder (too much noise)

**Instead:**
1. Requeue 1-2 test jobs
2. Monitor for success
3. Only then consider more requeues

### ⚠️  Watch for Oscillation

If a job keeps bouncing between `queued` → `failed` → `dead_letter`:

**Stop requeuing and:**
1. Review error details again
2. Check if fix was actually deployed
3. Verify job payload is valid
4. Escalate to engineering if stuck

### ⚠️  Respect Max Attempts

The DLQ exists for a reason. If a job failed 5 times with exponential backoff, there's a real issue.

**Don't:**
- Requeue the same job 10+ times
- Ignore persistent failures
- Bypass DLQ by directly updating DB

**Do:**
- Investigate thoroughly
- Fix root cause
- Requeue sparingly

---

## Common Scenarios & Solutions

### Scenario 1: FFmpeg Timeout

**Symptoms:**
- Error: `FFmpeg timeout after 300 seconds`
- Job kind: `TRANSCRIBE`, `CLIP_RENDER`

**Root causes:**
- Video is very long (> 5 minutes)
- FFmpeg is slow or misconfigured
- Insufficient worker resources

**Recovery:**
1. Check if timeout limit needs increase (code change)
2. If transient (e.g., slow disk), safe to requeue
3. If video is truly too long, job will fail again

### Scenario 2: Source File Not Found

**Symptoms:**
- Error: `ENOENT: no such file or directory`
- Job kind: `CLIP_RENDER`, `TRANSCRIBE`

**Root causes:**
- File was deleted from storage
- Incorrect storage path in payload
- Storage bucket misconfigured

**Recovery:**
1. Check if file exists in storage bucket
2. If path was wrong (bug), fix + deploy + requeue
3. If file is truly missing, job cannot succeed

### Scenario 3: API Credentials Expired

**Symptoms:**
- Error: `401 Unauthorized` or `Invalid credentials`
- Job kind: `PUBLISH_YOUTUBE`, `PUBLISH_TIKTOK`

**Root causes:**
- OAuth token expired
- API key rotated
- Account suspended

**Recovery:**
1. Refresh OAuth token or update API key
2. Verify credentials work (manual test)
3. Requeue affected jobs

### Scenario 4: Database Connection Blip

**Symptoms:**
- Error: `connection to server was lost`
- Many jobs across different kinds
- All failed in same 5-minute window

**Root causes:**
- Supabase/database had brief outage
- Network hiccup
- Worker restart

**Recovery:**
1. Confirm infrastructure is healthy now
2. Safe to requeue all affected jobs
3. Monitor for immediate success

---

## When to Escalate

Escalate to engineering if:

- ❌ DLQ count > 100 and growing
- ❌ Same jobs keep returning to DLQ after requeue
- ❌ Root cause is unclear after inspection
- ❌ Multiple job kinds failing with different errors
- ❌ Requeued jobs cause worker crashes
- ❌ No fix can be deployed (architecture issue)

**Escalation details to include:**
- Output of `pnpm jobs:stats`
- Output of `pnpm dlq:list --limit=20`
- Sample job inspection (`pnpm dlq:inspect <jobId>`)
- Timeline of when failures started
- Any recent deployments or config changes

---

## Related Runbooks

- [Job Debugging](./job-debugging.md) — How to debug stuck or slow jobs
- [Worker Debugging](./worker-debugging.md) — How to debug worker availability issues

## Related Commands

```bash
# Inspection
pnpm dlq:list                   # List all DLQ jobs
pnpm dlq:inspect <jobId>        # Inspect single job
pnpm jobs:stats                 # Overall queue health

# Recovery
pnpm dlq:requeue <jobId>        # Requeue single job

# Monitoring
pnpm jobs:status <jobId>        # Check job status after requeue
pnpm workers:status             # Check worker availability
```

---

**Last Updated:** 2025-12-08  
**Maintained By:** Engineering Team  
**Feedback:** Report issues or improvements to runbook in team Slack

