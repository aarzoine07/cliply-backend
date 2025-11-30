# Machine Vocabulary ↔ Backend Mapping

This document defines the explicit mapping between Machine/Pipeline concepts and the Cliply backend implementation.

**Purpose:** Ensure consistent terminology across pipelines, API, and documentation without requiring schema changes.

---

## 1. Video Project

**Machine Concept:** `video_project`

**Backend Implementation:** `projects` table row

**Columns:**
- `id` — Project UUID
- `workspace_id` — Owner workspace
- `source_type` — e.g., 'tiktok', 'upload'
- `source_path` — Original video location
- `status` — Processing state (e.g., 'pending', 'processing', 'completed', 'failed')
- `metadata` — JSONB field for additional project data

**Usage:** A video project represents the root entity for all processing work.

---

## 2. Transcripts + Segments

**Machine Concepts:** `transcript`, `segments`, `chunks`

**Backend Implementation:** 
- **SRT file** stored in `transcripts` bucket (Supabase Storage)
- **transcript.json** stored in `transcripts` bucket

**transcript.json Structure:**
```json
{
  "segments": [
    {
      "id": "<segment-id>",
      "start": <seconds>,
      "end": <seconds>,
      "text": "<transcript text>",
      "confidence": <0-1>
    }
  ]
}
```

**Usage:** Transcription output from speech-to-text pipelines. SRT for human readability, JSON for programmatic access.

---

## 3. Clip Candidates

**Machine Concept:** `clip_candidates`

**Backend Implementation:** `clips` table rows with `status = 'proposed'`

**Key Columns:**
- `project_id` — Parent video project
- `start_s` — Clip start time in seconds
- `end_s` — Clip end time in seconds
- `status` — Must be `'proposed'` for candidates
- `confidence` — Detection confidence score (may be in JSONB field or dedicated column)

**Usage:** Potential highlights detected by ML pipelines, awaiting user review or automatic selection.

---

## 4. Generated Clips

**Machine Concept:** `generated_clips`

**Backend Implementation:** `clips` table rows with `status IN ('ready', 'published', 'failed')`

**Status Values:**
- `'ready'` — Rendered and available for download/publish
- `'published'` — Successfully posted to destination platform
- `'failed'` — Rendering or publishing failed

**Usage:** Clips that have been processed beyond the candidate stage, regardless of success or failure.

---

## Summary Table

| Machine Concept      | Backend Table/Storage          | Discriminator                        |
|----------------------|--------------------------------|--------------------------------------|
| `video_project`      | `projects`                     | —                                    |
| `transcript`         | `transcripts` bucket (SRT)     | —                                    |
| `segments`           | `transcripts` bucket (JSON)    | `segments` array                     |
| `clip_candidates`    | `clips`                        | `status = 'proposed'`                |
| `generated_clips`    | `clips`                        | `status IN ('ready','published','failed')` |

---

## Notes

- **No new tables or columns** are introduced by this mapping.
- All mappings use existing schema as-is.
- This document is the single source of truth for terminology alignment.

