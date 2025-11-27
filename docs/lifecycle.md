# Projects & Clips Lifecycle

This document describes the lifecycle states and transitions for Projects and Clips in the Cliply backend.

## Project Lifecycle

Projects flow through the following status values:

- **queued** → "uploaded / pre-processing"
  - Initial state when a project is created
  - Represents uploaded content awaiting processing

- **processing** → "transcribing / analyzing / clipping / rendering"
  - Active processing state
  - Includes transcription, highlight detection, clip generation, and rendering

- **ready** → "done (clips generated and rendered)"
  - Processing complete
  - Clips have been generated and rendered

- **error** → "failed"
  - Processing failed at any stage

### Status Flow

```
queued → processing → ready | error
```

## Clip Lifecycle

Clips flow through the following status values:

- **proposed** → Initial clip suggestion from highlight detection
- **approved** → User approved the clip for rendering
- **rejected** → User rejected the clip
- **rendering** → Clip is being rendered
- **ready** → Clip rendering complete, ready for use
- **published** → Clip has been published to external platform
- **failed** → Clip processing/rendering failed

### Status Flow

```
proposed → approved/rejected → rendering → ready/published/failed
```

## Machine Language Mapping

The following mappings connect Machine stage language to database status values:

| Machine Language | Project Status |
|-----------------|----------------|
| "uploaded"      | queued         |
| "processing"    | processing     |
| "done"          | ready          |
| "failed"        | error          |

