# Storage Layout — Cliply Backend

This document describes the bucket organization and path conventions for all storage artifacts in Cliply.

## Overview

Cliply uses **Supabase Storage** with four dedicated buckets. All buckets are private (not public).

## Buckets

| Bucket Name     | Purpose                                  | Example Path                                           |
|-----------------|------------------------------------------|--------------------------------------------------------|
| `videos`        | Original uploaded source videos          | `{workspaceId}/{projectId}/source.mp4`                 |
| `transcripts`   | Transcript files (SRT + JSON)            | `{workspaceId}/{projectId}/transcript.srt`             |
| `renders`       | Rendered clip videos                     | `{workspaceId}/{projectId}/{clipId}.mp4`               |
| `thumbs`        | Clip thumbnail images                    | `{workspaceId}/{projectId}/{clipId}.jpg`               |

## Path Conventions

### 1. Source Videos (`videos` bucket)

**Pattern:** `{workspaceId}/{projectId}/source.{ext}`

**Example:**
```
f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/source.mp4
```

**Mapping to Machine Terminology:**
- Database: `projects.source_path` stores `videos/{workspaceId}/{projectId}/source.{ext}`
- Used by: Upload API, Transcribe pipeline, Render pipeline

---

### 2. Transcripts (`transcripts` bucket)

**Pattern (SRT):** `{workspaceId}/{projectId}/transcript.srt`  
**Pattern (JSON):** `{workspaceId}/{projectId}/transcript.json`

**Example:**
```
f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transcript.srt
f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/transcript.json
```

**Mapping to Machine Terminology:**
- Database: `projects.transcript` (TEXT column) stores **inline SRT text** (deprecated pattern)
- Storage: **SRT file** in `transcripts` bucket is the canonical source
- Storage: **JSON file** contains full segment metadata
- Used by: Transcribe pipeline, Highlight-detect pipeline, Render pipeline

---

### 3. Rendered Clips (`renders` bucket)

**Pattern:** `{workspaceId}/{projectId}/{clipId}.{ext}`

**Example:**
```
f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/x9y8z7w6-v5u4-3210-t9s8-r7q6p5o4n3m2.mp4
```

**Mapping to Machine Terminology:**
- Database: `clips.storage_path` stores `renders/{workspaceId}/{projectId}/{clipId}.mp4`
- Used by: Render pipeline, Publish pipeline, Thumbnail pipeline

---

### 4. Thumbnails (`thumbs` bucket)

**Pattern:** `{workspaceId}/{projectId}/{clipId}.{ext}`

**Example:**
```
f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/x9y8z7w6-v5u4-3210-t9s8-r7q6p5o4n3m2.jpg
```

**Mapping to Machine Terminology:**
- Database: `clips.thumb_path` stores `thumbs/{workspaceId}/{projectId}/{clipId}.jpg`
- Used by: Render pipeline (creates thumbnail during render), Thumbnail pipeline (dedicated re-generation)

---

## Path Builder Functions

All path construction should use the centralized functions in:

```
packages/shared/storage/paths.ts
```

### Available Functions

| Function                 | Returns                                              | Bucket        |
|--------------------------|------------------------------------------------------|---------------|
| `projectSourcePath()`    | `{workspaceId}/{projectId}/source.{ext}`             | `videos`      |
| `transcriptSrtPath()`    | `{workspaceId}/{projectId}/transcript.srt`           | `transcripts` |
| `transcriptJsonPath()`   | `{workspaceId}/{projectId}/transcript.json`          | `transcripts` |
| `clipRenderPath()`       | `{workspaceId}/{projectId}/{clipId}.{ext}`           | `renders`     |
| `clipThumbnailPath()`    | `{workspaceId}/{projectId}/{clipId}.{ext}`           | `thumbs`      |

### Usage Example

```typescript
import { BUCKET_VIDEOS, projectSourcePath } from '@cliply/shared/storage/paths';

const workspaceId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const projectId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ext = 'mp4';

const path = projectSourcePath(workspaceId, projectId, ext);
// Result: 'f47ac10b-58cc-4372-a567-0e02b2c3d479/a1b2c3d4-e5f6-7890-abcd-ef1234567890/source.mp4'

// Use with storage client:
await ctx.storage.download(BUCKET_VIDEOS, path, localPath);
```

---

## Database Column Mapping

| Database Column         | Storage Bucket  | Path Pattern                                  | Builder Function            |
|-------------------------|-----------------|-----------------------------------------------|-----------------------------|
| `projects.source_path`  | `videos`        | `{workspaceId}/{projectId}/source.{ext}`      | `projectSourcePath()`       |
| `clips.storage_path`    | `renders`       | `{workspaceId}/{projectId}/{clipId}.mp4`      | `clipRenderPath()`          |
| `clips.thumb_path`      | `thumbs`        | `{workspaceId}/{projectId}/{clipId}.jpg`      | `clipThumbnailPath()`       |

**Note:** Transcript files are stored in `transcripts` bucket but not directly referenced in database columns (yet). The `projects.transcript` column stores inline SRT text (legacy pattern).

---

## References

- See `machine-mapping.md` for full Machine terminology alignment
- See `packages/shared/storage/paths.ts` for implementation
- See pipeline implementations in `apps/worker/src/pipelines/`

