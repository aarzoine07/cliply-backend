# Pipeline Names & Mapping

## Canonical Pipeline Names

The following pipeline names are the canonical identifiers used in structured logging, Sentry tags, and Machine orchestration:

- `transcribe`
- `highlight_detect`
- `clip_render`
- `publish_tiktok`
- `publish_youtube`

## JobKind → Pipeline Mapping

| `job.kind` (DB Enum) | Pipeline Name | File |
|----------------------|---------------|------|
| `TRANSCRIBE` | `transcribe` | `apps/worker/src/pipelines/transcribe.ts` |
| `HIGHLIGHT_DETECT` | `highlight_detect` | `apps/worker/src/pipelines/highlight-detect.ts` |
| `CLIP_RENDER` | `clip_render` | `apps/worker/src/pipelines/clip-render.ts` |
| `PUBLISH_TIKTOK` | `publish_tiktok` | `apps/worker/src/pipelines/publish-tiktok.ts` |
| `PUBLISH_YOUTUBE` | `publish_youtube` | `apps/worker/src/pipelines/publish-youtube.ts` |

## Additional Job Kinds (No Pipeline)

The following job kinds exist in the database but do not have associated pipeline constants (yet):

- `THUMBNAIL_GEN` → `apps/worker/src/pipelines/thumbnail.ts`
- `YOUTUBE_DOWNLOAD` → `apps/worker/src/pipelines/youtube-download.ts`

## Usage

Import pipeline constants from `@cliply/shared/pipeline/names`:

```typescript
import { PIPELINE_TRANSCRIBE, type PipelineName } from '@cliply/shared/pipeline/names';
```

Use them in structured logs and Sentry tags:

```typescript
logPipelineStep({ pipeline: PIPELINE_TRANSCRIBE, ... });
```

