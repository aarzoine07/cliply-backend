# ✅ EI-05: Storage Cleanup System (Artifacts + Temp Files) — COMPLETE

## Summary

Successfully implemented ME-I-05 by creating a comprehensive storage cleanup system that prevents unbounded growth of temp/intermediate artifacts in both Supabase storage and local disk. The system includes:
- A new `CLEANUP_STORAGE` job type and pipeline for cleaning failed/orphaned renders
- Automatic temp file cleanup integrated into existing pipelines (transcribe, render, publish)
- Safe, idempotent cleanup operations with configurable retention windows
- Storage adapter extensions for batch deletion
- Comprehensive test coverage

## Files Created

### 1. `packages/shared/src/schemas/jobs.ts` (extended)
- Added `CLEANUP_STORAGE` job schema
- Supports optional `workspaceId`, `projectId`, and `retentionDays` parameters
- Validates UUIDs and retention ranges (1-365 days)

### 2. `apps/worker/src/pipelines/cleanup-storage.ts` (280 lines)
- **Default retention:** 30 days for temp/intermediate artifacts
- **Safety minimum:** 7 days (enforced lower bound)
- **Two cleanup strategies:**
  1. **Failed renders:** Deletes clips with `status='failed'` older than retention window
  2. **Orphaned renders:** Deletes storage files with no corresponding DB records
- **What is NOT deleted:**
  - Final rendered clips (`status='ready'` or `'published'`)
  - Source videos in `BUCKET_VIDEOS` (user uploads)
  - Transcripts in `BUCKET_TRANSCRIPTS` (needed for re-processing)
  - Any artifacts newer than retention window
- **Batch deletion:** Processes files in chunks of 500 for efficiency
- **Structured logging:** `storage_cleanup_start`, `cleanup_deleted_failed_renders`, `cleanup_deleted_orphaned_renders`, `storage_cleanup_complete`

### 3. `apps/worker/src/lib/tempCleanup.ts` (63 lines)
- **`cleanupTempDirSafe()`**: Recursively deletes temp directories
- **`cleanupTempFileSafe()`**: Deletes individual temp files
- **Best-effort cleanup:** Never throws, logs warnings on failure
- **Safety checks:** Prevents deletion of root `/` or current `.` directories
- **Idempotent:** Handles `ENOENT` (already deleted) gracefully

### 4. `apps/worker/src/pipelines/types.ts` (extended)
- Added `remove(bucket, path)` method to `StorageAdapter`
- Added `removeBatch(bucket, paths[])` method for batch deletion
- Both methods handle missing files gracefully

### 5. `apps/worker/src/services/storage.ts` (extended)
- Implemented `remove()` and `removeBatch()` methods
- `removeBatch()` processes deletions in chunks of 500
- Returns counts of successfully deleted files
- Treats "not found" errors as success (idempotent)

### 6. `test/worker/cleanup-storage.test.ts` (415 lines)
- **7 test suites, all passing:**
  - Basic cleanup operations (3 tests)
  - Failed renders cleanup (1 test)
  - Orphaned renders cleanup (1 test)
  - Error handling (2 tests)
- **Coverage:** Retention enforcement, failed clip deletion, orphaned file detection, DB errors, exception handling

## Files Modified

### 7. `apps/worker/src/worker.ts`
- Imported `runCleanupStorage` pipeline
- Registered `CLEANUP_STORAGE` handler in the handlers map
- Jobs of type `CLEANUP_STORAGE` are now executed by the worker

### 8. `apps/worker/src/pipelines/transcribe.ts`
- Added `tempDir` tracking variable
- Wrapped pipeline logic in `try/finally` block
- Calls `cleanupTempDirSafe(tempDir)` in `finally` (on both success and failure)

### 9. `apps/worker/src/pipelines/clip-render.ts`
- Added `tempDir` tracking variable
- Wrapped pipeline logic in `try/finally` block
- Calls `cleanupTempDirSafe(tempDir)` in `finally` (on both success and failure)

### 10. `apps/worker/src/pipelines/publish-tiktok.ts`
- Added `tempPath` tracking variable for downloaded clip
- Wrapped pipeline logic in `try/finally` block
- Calls `cleanupTempFileSafe(tempPath)` in `finally` (on both success and failure)

### 11. `apps/worker/src/pipelines/publish-youtube.ts`
- Added `tempPath` tracking variable for downloaded clip
- Wrapped pipeline logic in `try/finally` block
- Calls `cleanupTempFileSafe(tempPath)` in `finally` (on both success and failure)

## Cleanup Policy (Safety-First)

### Safe to Delete:
1. **Failed renders** (`clips.status = 'failed'` AND `updated_at < cutoff`)
   - Deletes from `BUCKET_RENDERS` and `BUCKET_THUMBS`
   - Clips must be older than retention window
2. **Orphaned renders** (files in storage with no DB record)
   - Checks for matching `clip.id` in database
   - Only deletes if no corresponding clip exists
3. **Local temp files** (per-job directories/files)
   - Always cleaned up after job completion
   - Cleaned up even on pipeline failure

### Never Deleted:
- Final rendered clips (`status = 'ready'` or `'published'`)
- Source videos in `BUCKET_VIDEOS` (user uploads)
- Transcripts in `BUCKET_TRANSCRIPTS` (needed for re-processing)
- Any artifacts newer than retention window
- Metadata in database tables (clips, projects, jobs, etc.)

## Test Results

### New Cleanup Tests
✅ **7/7 tests passing**
```bash
pnpm test test/worker/cleanup-storage.test.ts --run
# Test Files  1 passed (1)
# Tests  7 passed (7)
```

### Regression Tests (All Passing)
✅ **postingGuard:** 30/30 passing  
✅ **clipCount:** 30/30 passing  
✅ **clipOverlap:** 26/26 passing  
✅ **usageTracker.posts:** 14/14 passing  

**Total:** 107/107 tests passing (100 regressions + 7 new)

```bash
pnpm test test/engine/postingGuard.test.ts test/engine/clipCount.test.ts test/engine/clipOverlap.test.ts test/shared/usageTracker.posts.test.ts --run
# Test Files  4 passed (4)
# Tests  100 passed (100)
```

### Build Status
✅ **Shared package:** Builds successfully  
✅ **Worker package:** Builds successfully  
⚠️ **Web package:** Pre-existing error (unrelated to EI-05 changes)

## Usage Examples

### Example 1: Global Cleanup (Cron Job)
**Scenario:** Scheduled cleanup across all workspaces

```typescript
await ctx.queue.enqueue({
  type: 'CLEANUP_STORAGE',
  workspaceId: 'system', // Any valid workspace ID required
  payload: {
    // No workspaceId or projectId → global cleanup
    retentionDays: 30, // Optional, defaults to 30
  },
});
```

**Behavior:**
- Scans all buckets for failed/orphaned renders
- Deletes artifacts older than 30 days
- Logs: `cleanup_deleted_failed_renders`, `cleanup_deleted_orphaned_renders`

### Example 2: Workspace-Specific Cleanup
**Scenario:** Clean up a specific workspace (e.g., after account deletion)

```typescript
await ctx.queue.enqueue({
  type: 'CLEANUP_STORAGE',
  workspaceId: 'workspace-abc',
  payload: {
    workspaceId: 'workspace-abc',
    retentionDays: 7, // Aggressive cleanup
  },
});
```

**Behavior:**
- Only processes files belonging to `workspace-abc`
- Uses 7-day retention (minimum enforced)
- Scoped queries and storage prefixes

### Example 3: Project-Level Cleanup
**Scenario:** Clean up a single project after deletion

```typescript
await ctx.queue.enqueue({
  type: 'CLEANUP_STORAGE',
  workspaceId: 'workspace-abc',
  payload: {
    workspaceId: 'workspace-abc',
    projectId: 'project-123',
    retentionDays: 1, // Will be bumped to 7 (minimum)
  },
});
```

**Behavior:**
- Only processes files for `project-123` in `workspace-abc`
- Minimum retention (7 days) enforced for safety
- Highly targeted cleanup

### Example 4: Automatic Temp Cleanup (Transcribe)

**Before:**
```typescript
// temp files left behind on failure
const tempDir = await fs.mkdtemp(join(tmpdir(), 'cliply-transcribe-'));
// ... transcription work ...
// ❌ No cleanup if error occurs
```

**After:**
```typescript
let tempDir = null;
try {
  tempDir = await fs.mkdtemp(join(tmpdir(), 'cliply-transcribe-'));
  // ... transcription work ...
} catch (error) {
  // ... error handling ...
  throw error;
} finally {
  // ✅ Always cleaned up
  if (tempDir) {
    await cleanupTempDirSafe(tempDir, ctx.logger);
  }
}
```

**Result:** Temp directories are cleaned up on both success and failure.

## Observability

### Log Events

**Cleanup Start:**
```json
{
  "event": "storage_cleanup_start",
  "pipeline": "CLEANUP_STORAGE",
  "jobId": "job-123",
  "workspaceId": "workspace-abc",
  "targetWorkspaceId": "workspace-abc",
  "targetProjectId": "all",
  "retentionDays": 30,
  "cutoffDate": "2025-11-07T12:00:00.000Z"
}
```

**Deleted Failed Renders:**
```json
{
  "event": "cleanup_deleted_failed_renders",
  "bucket": "renders",
  "count": 15,
  "workspaceId": "workspace-abc"
}
```

**Deleted Orphaned Renders:**
```json
{
  "event": "cleanup_deleted_orphaned_renders",
  "bucket": "renders",
  "count": 8,
  "orphanedClipIds": 8,
  "workspaceId": "workspace-abc"
}
```

**Cleanup Complete:**
```json
{
  "event": "storage_cleanup_complete",
  "pipeline": "CLEANUP_STORAGE",
  "jobId": "job-123",
  "workspaceId": "workspace-abc",
  "totalFilesDeleted": 23,
  "failedClipsDeleted": 15,
  "orphanedRendersDeleted": 8,
  "durationMs": 2450
}
```

**Temp Cleanup Warning (non-critical):**
```json
{
  "event": "temp_dir_cleanup_failed",
  "path": "/tmp/cliply-render-abc123",
  "error": "EACCES: permission denied",
  "code": "EACCES"
}
```

## Safety Features

### 1. Minimum Retention Enforcement
```typescript
const retentionDays = Math.max(
  payload.retentionDays ?? DEFAULT_RETENTION_DAYS,
  MIN_RETENTION_DAYS // 7 days minimum
);
```
**Why:** Prevents accidental deletion of recent artifacts.

### 2. Status-Based Filtering
```typescript
// Only delete clips with status='failed'
.eq("status", "failed")
.lt("updated_at", cutoffDate.toISOString())
```
**Why:** Never deletes `'ready'` or `'published'` clips.

### 3. Idempotent Deletion
```typescript
// Treats "not found" as success
if (error.message?.includes("not found")) {
  return false; // Don't throw
}
```
**Why:** Safe to re-run cleanup jobs.

### 4. Batched Operations
```typescript
const BATCH_SIZE = 500;
for (let i = 0; i < paths.length; i += BATCH_SIZE) {
  const batch = paths.slice(i, i + BATCH_SIZE);
  await supabase.storage.from(bucket).remove(batch);
}
```
**Why:** Prevents memory issues and API rate limits.

### 5. Best-Effort Temp Cleanup
```typescript
// Never throws, only logs warnings
try {
  await fs.rm(path, { recursive: true, force: true });
} catch (error) {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code !== 'ENOENT') {
    logger?.warn?.('temp_dir_cleanup_failed', { path, error: ... });
  }
}
```
**Why:** Doesn't crash jobs if temp cleanup fails.

## Integration with Existing Systems

### Job Queue System
- Uses existing `jobs` table and polling mechanism
- Participates in worker heartbeat and stale job reclamation
- Consistent logging with other pipelines

### Storage System
- Extends existing `StorageAdapter` interface
- Uses Supabase Storage API (`.remove()` method)
- Works with existing buckets: `renders`, `thumbs`, `videos`, `transcripts`

### Database Schema
- **No migrations required**
- Uses existing `clips` table (`status`, `updated_at` columns)
- Queries are read-only except for storage deletions

### Observability
- Consistent structured logging (`ctx.logger`)
- Sentry exception capture (`ctx.sentry.captureException`)
- Pipeline stage tracking for consistency

## Future Enhancements (Out of Scope for EI-05)

1. **Metrics Dashboard:**
   - Track total storage freed over time
   - Show per-workspace storage usage
   - Alert on unbounded growth

2. **Scheduled Cleanup:**
   - Cron-based automatic cleanup (e.g., daily at 3 AM)
   - Configurable per-workspace retention policies

3. **Transcript Cleanup:**
   - Clean up old transcripts for deleted projects
   - Currently excluded for safety

4. **Source Video Cleanup:**
   - Clean up source videos after successful renders
   - Requires user consent (may want to re-process)

5. **Fine-Grained Policies:**
   - Different retention windows per artifact type
   - Plan-based retention (e.g., premium keeps longer)

## Acceptance Criteria

✅ **CLEANUP_STORAGE job type added and wired**
- Schema defined in `packages/shared/src/schemas/jobs.ts`
- Handler registered in `apps/worker/src/worker.ts`
- Pipeline executes and completes successfully

✅ **Clear cleanup policy implemented**
- Failed renders: `status='failed'` AND `updated_at < cutoff`
- Orphaned renders: Files in storage with no DB record
- Never deletes final renders, sources, or transcripts
- Enforces minimum 7-day retention

✅ **Idempotent and safe**
- Re-running cleanup jobs is safe (no crashes)
- Missing files treated as success
- Defensive error handling throughout

✅ **Local temp cleanup integrated**
- Transcribe pipeline: `try/finally` with `cleanupTempDirSafe`
- Clip-render pipeline: `try/finally` with `cleanupTempDirSafe`
- Publish pipelines: `try/finally` with `cleanupTempFileSafe`
- Cleanup occurs on both success and failure

✅ **Tests added and passing**
- New cleanup tests: 7/7 ✅
- Regression tests: 100/100 ✅
- Total: 107/107 tests passing

✅ **Build succeeds**
- Shared package: ✅
- Worker package: ✅
- No new compilation errors introduced

All acceptance criteria met! 🎉

