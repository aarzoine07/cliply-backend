# Cliply Backend State

Generated: 2025-10-16 12:55:13 -04:00

## Git

## main...origin/main
 M REPORTS/backend_state.md
 M apps/web/src/lib/supabase.ts
 M apps/web/src/pages/api/health.ts
 M apps/web/src/server.ts
 M package.json
 M scripts/snapshot.ps1
 M vitest.config.ts
?? packages/shared/env.ts
?? packages/shared/logger.ts
?? test/example.test.ts

origin	https://github.com/aarzoine07/cliply-backend.git (fetch)
origin	https://github.com/aarzoine07/cliply-backend.git (push)

## Tooling (node/pnpm/tsc)

node: v22.17.0
pnpm: 10.15.0
tsc: tsc not found

## Packages

cliply-backend C:\Users\aarzo\cliply-backend (PRIVATE)

@cliply/web C:\Users\aarzo\cliply-backend\apps\web (PRIVATE)

@cliply/worker@0.0.1 C:\Users\aarzo\cliply-backend\apps\worker (PRIVATE)

@cliply/shared@0.0.1 C:\Users\aarzo\cliply-backend\packages\shared (PRIVATE)

## Env presence (names only)

Env files:
.env
.env.back
.env.bak-20251005044023
.env.bak-20251005044031
.env.bak-20251005044052
.env.bak-20251005044829
.env.bak-20251005045130
.env.local

Env vars:
DATABASE_URL=True
SUPABASE_URL=False
SUPABASE_ANON_KEY=False
OPENAI_API_KEY=False
DEEPGRAM_API_KEY=False
TIKTOK_CLIENT_KEY=False
TIKTOK_CLIENT_SECRET=False
STRIPE_SECRET_KEY=False
SENTRY_DSN=False

## SQL Tables Probe

Tables found (14):
workspace_members
org_workspaces
projects
schedules
clips
jobs
connected_accounts
events
rate_limits
clip_products
idempotency
products
organizations
workspaces

Required tables present: 7 of 7
Migrate flag: PASS

## Dev server detect

Detected port: 3001

## Health Check

Detected port: 3001
Health flag: PASS
Payload:
{"ok":true,"service":"api","env":"development","uptime_ms":23572,"db":"ok","db_name":"postgres"}

## Tests


[1m[46m RUN [49m[22m [36mv3.2.4 [39m[90mC:/Users/aarzo/cliply-backend[39m

 [32mΓ£ô[39m test/example.test.ts[2m > [22mmath[2m > [22madds numbers[32m 1[2mms[22m[39m

[2m Test Files [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m      Tests [22m [1m[32m1 passed[39m[22m[90m (1)[39m
[2m   Start at [22m 12:55:14
[2m   Duration [22m 564ms[2m (transform 50ms, setup 0ms, collect 36ms, tests 2ms, environment 1ms, prepare 187ms)[22m


Tests flag: PASS

## Summary

Typecheck: PASS
Migrate: PASS
FFmpeg: PASS
Dev port: 3001
Health: PASS
Tests: PASS
Vercel: PASS
Report: C:\Users\aarzo\cliply-backend\REPORTS\backend_state.md
