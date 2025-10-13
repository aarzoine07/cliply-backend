2025-10-09 03:40:24 -04:00

# Cliply Backend State

## Git

origin	https://github.com/aarzoine07/cliply-backend.git (fetch)
origin	https://github.com/aarzoine07/cliply-backend.git (push)
scaffold/step0-non-destructive
## scaffold/step0-non-destructive...origin/scaffold/step0-non-destructive [ahead 1]
 M .vscode/settings.json
 M apps/web/package.json
 D apps/web/src/app/api/health/route.js
 D apps/web/src/app/api/health/route.ts
 D apps/web/src/app/api/upload/init/route.js
 D apps/web/src/app/api/upload/init/route.ts
 M apps/web/src/pages/api/clips/[id]/approve.ts
 M apps/web/src/pages/api/upload/init.ts
 M apps/web/test/api/upload-init.test.ts
 M apps/worker/package.json
 M apps/worker/src/jobs/backoff.ts
 M apps/worker/src/jobs/claim.ts
 M apps/worker/src/jobs/run.ts
 M apps/worker/src/pipelines/clip-render.ts
 M apps/worker/src/pipelines/highlight-detect.ts
 M apps/worker/src/pipelines/publish-youtube.ts
 M apps/worker/src/pipelines/thumbnail.ts
 M apps/worker/src/pipelines/transcribe.ts
 M apps/worker/src/services/captions/srt.ts
 M apps/worker/src/services/ffmpeg/build-commands.ts
 M apps/worker/src/services/ffmpeg/run.ts
 M apps/worker/src/services/transcriber/deepgram.ts
 M apps/worker/src/services/transcriber/index.ts
 M apps/worker/src/services/transcriber/whisper.ts
 M apps/worker/src/services/youtube/client.ts
 M package.json
 M packages/shared/src/index.ts
 M packages/shared/src/schemas.ts
 M packages/shared/src/schemas/upload.ts
 M pnpm-lock.yaml
?? REPORTS/
?? _supabase_cli/
?? apps/web/src/server.ts
?? apps/web/src/server.ts.bak-20251005042747
?? apps/web/src/server.ts.bak-20251005042759
?? apps/web/src/server.ts.bak-20251005045824
?? apps/web/src/server.ts.bak-20251005050058
?? apps/web/src/server.ts.bak-20251005065803
?? apps/web/src/server.ts.bak-20251005070956
?? apps/web/test/routes.duplication.guard.test.ts
?? apps/worker/src/pipelines/types.ts
?? apps/worker/test/
?? packages/shared/src/schemas/index.ts
?? packages/shared/src/schemas/jobs.ts
?? scripts/db/
?? scripts/snapshot.ps1
?? scripts/snapshot.ps1.bak
?? scripts/snapshot.ps1.bak-20251001-022017
?? scripts/snapshot.ps1.bak-20251003133003
?? scripts/snapshot.ps1.bak-20251003133944
?? scripts/snapshot.ps1.bak-20251003141542
?? scripts/snapshot.ps1.bak-20251003141627
?? scripts/snapshot.ps1.bak-20251003141756
?? scripts/snapshot.ps1.bak-20251003141811
?? scripts/snapshot.ps1.bak-20251003151016
?? scripts/snapshot.ps1.bak-20251003151108
?? scripts/snapshot.ps1.bak-20251003155726
?? scripts/snapshot.ps1.bak-20251005041743
?? scripts/snapshot.ps1.bak-20251005041815
?? scripts/snapshot.ps1.bak-20251005042001
?? scripts/snapshot.ps1.bak-20251005042901
?? scripts/snapshot.ps1.bak-20251005043146
?? scripts/snapshot.ps1.bak-20251005142354
?? scripts/snapshot.ps1.bak-20251005142424
?? scripts/snapshot.ps1.bak-20251005142440
?? scripts/snapshot.ps1.bak-20251005142501
?? scripts/snapshot.ps1.bak-20251005142528
?? scripts/snapshot.sh
?? scripts/test.ps1
?? supabase/
?? temp_patch.diff
?? test/worker/jobs.flow.test.ts
?? tmp_dbcheck.js
?? tmp_dbcheck.txt
?? tmp_health.json
?? tmp_list_tables.cjs
?? tmp_list_tables.js
?? tmp_logtail.txt
?? tmp_masked.txt
?? tmp_port.txt
?? tmp_routes.json
?? tmp_server_ok.txt
?? tmp_server_pid.txt
?? tmp_snapshot_output.txt
?? tmp_snapshot_raw.txt
?? tmp_summary.txt
?? tmp_tables.json
?? tmp_tables.txt


## Tooling

node: v22.17.0
pnpm: 10.15.0
tsc: tsc not found


## Packages

cliply-backend C:\Users\aarzo\cliply-backend (PRIVATE)

@cliply/web C:\Users\aarzo\cliply-backend\apps\web (PRIVATE)

@cliply/worker@0.0.1 C:\Users\aarzo\cliply-backend\apps\worker (PRIVATE)

@cliply/shared@0.0.1 C:\Users\aarzo\cliply-backend\packages\shared (PRIVATE)


## Env files

.env
.env.back
.env.bak-20251005044023
.env.bak-20251005044031
.env.bak-20251005044052
.env.bak-20251005044829
.env.bak-20251005045130
.env.local


## Env presence (masked)

DATABASE_URL=True
SUPABASE_URL=False
SUPABASE_ANON_KEY=False
OPENAI_API_KEY=False
DEEPGRAM_API_KEY=False
TIKTOK_CLIENT_KEY=False
TIKTOK_CLIENT_SECRET=False
STRIPE_SECRET_KEY=False
SENTRY_DSN=False


## Prisma & SQL Migrate

'prisma' is not recognized as an internal or external command,
operable program or batch file.
undefined
G«ÎERR_PNPM_RECURSIVE_EXEC_FIRST_FAILG«Î Command "prisma" not found
---
'prisma' is not recognized as an internal or external command,
operable program or batch file.
undefined
G«ÎERR_PNPM_RECURSIVE_EXEC_FIRST_FAILG«Î Command "prisma" not found
---
SQL tables PASS=False


## Dev server

DETECTED_PORT=3001


## Health Check

{"ok":true,"service":"api","env":"development","uptime_ms":1779453,"db":"ok","db_name":"postgres"}


## Summary

Typecheck: PASS
Migrate: FAIL
FFmpeg: PASS
Dev port: 3001
Health: PASS
Tests: FAIL
Vercel: PASS
Report: C:\Users\aarzo\cliply-backend\REPORTS\backend_state.md


