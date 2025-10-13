#!/usr/bin/env bash
set -euo pipefail
root="$(pwd)"; reports="$root/REPORTS"; log="$reports/backend_state.md"
mkdir -p "$reports"
append(){ printf '## %s
```\n' "$1" >>"$log"; cat >>"$log"; printf '```\n\n' >>"$log"; }
date -Is > "$log"; printf '\n# Cliply Backend State\n' >>"$log"
{ git remote -v; echo; git branch --show-current; echo; git status -sb; } 2>&1 | append "Git"
{ echo -n "node: "; node -v || true; echo -n "pnpm: "; pnpm -v || true; echo -n "tsc: "; tsc -v || echo tsc not found; } 2>&1 | append "Tooling"
pnpm -r ls --depth -1 2>&1 | append "Packages"
{ pnpm install; echo ---; pnpm --filter server run typecheck || echo typecheck failed; } 2>&1 | append "Install & Typecheck"
{ ls -1 .env* 2>/dev/null || echo "no .env files found"; } | append "Env files"
{ for k in DATABASE_URL SUPABASE_URL SUPABASE_ANON_KEY OPENAI_API_KEY DEEPGRAM_API_KEY TIKTOK_CLIENT_KEY TIKTOK_CLIENT_SECRET STRIPE_SECRET_KEY SENTRY_DSN; do v=false; [ -n "${!k-}" ] && v=true; echo "$k=$v"; done; } | append "Env presence (masked)"
pushd server >/dev/null
{ pnpm prisma -v || echo "prisma not installed"; echo ---; pnpm prisma generate || echo "prisma generate failed"; echo ---; pnpm prisma migrate status || echo "migrate status failed"; } 2>&1 | append "Prisma & Migrations"
popd >/dev/null
{ supabase status || echo "supabase CLI not configured"; } 2>&1 | append "Supabase CLI"
{ ffmpeg -version 2>&1 | head -n1 || echo "ffmpeg missing"; ffprobe -version 2>&1 | head -n1 || echo "ffprobe missing"; } | append "FFmpeg/ffprobe"
pushd server >/dev/null
pnpm build 2>&1 | append "Build"
pnpm dev >/tmp/cliply_dev.log 2>&1 & DEV_PID=$!; sleep 6
detected=unknown
for p in 3001 3000 8787; do curl -fsS "http://localhost:$p/api/health" >/dev/null 2>&1 && { detected=$p; break; } || curl -fsS "http://localhost:$p/" >/dev/null 2>&1 && { detected=$p; break; }; done
printf 'DETECTED_PORT=%s\n' "$detected" | append "Dev server"
if [ "$detected" != unknown ]; then curl -i "http://localhost:$detected/api/health" 2>&1 | append "Health Check"; else echo "health route not reachable" | append "Health Check"; fi
if [ "$detected" != unknown ]; then curl -i "http://localhost:$detected/api/_routes" 2>&1 | append "Route Index" || echo "no route index" | append "Route Index"; else echo "no route index" | append "Route Index"; fi
popd >/dev/null
{ pnpm --filter server run queues:status || echo "no queues script"; } 2>&1 | append "Queues"
pushd server >/dev/null
{ pnpm test -- --reporter=verbose || echo "tests failed or not configured"; } 2>&1 | append "Tests"
popd >/dev/null
{ vercel whoami || echo "vercel CLI not configured"; echo ---; vercel link --confirm || echo "not linked"; } 2>&1 | append "Vercel"
kill $DEV_PID >/dev/null 2>&1 || true
echo "Typecheck: $(grep -qi 'typecheck failed' \"$log\" && echo FAIL || echo PASS)
Prisma generate: $(grep -qi 'prisma generate failed' \"$log\" && echo FAIL || echo PASS)
Migrate status: $(grep -qi 'migrate status failed' \"$log\" && echo FAIL || echo PASS)
FFmpeg: $(grep -qi 'ffmpeg missing' \"$log\" && echo FAIL || echo PASS)
Dev server: $(grep -q 'DETECTED_PORT=unknown' \"$log\" && echo FAIL || echo PASS)
Health: $(grep -qi 'health route not reachable' \"$log\" && echo FAIL || echo PASS)
Tests: $(grep -qi 'tests failed or not configured' \"$log\" && echo FAIL || echo PASS)
Vercel linked: $(grep -A1 '^## Vercel' \"$log\" | grep -qi 'not linked\|not configured' && echo FAIL || echo PASS)" | append "Summary"
branch="$(git branch --show-current 2>/dev/null || echo unknown)"
dirty="$(git status -sb | grep -E 'ahead|behind| M |?? ' >/dev/null && echo dirty || echo clean)"
nodev="$(node -v 2>/dev/null || echo n/a)"; pnpmv="$(pnpm -v 2>/dev/null || echo n/a)"
port="$(grep -o 'DETECTED_PORT=.*' \"$log\" | tail -n1 | cut -d= -f2)"
echo "Branch: $branch ($dirty)
node $nodev, pnpm $pnpmv
Typecheck: $(grep -qi 'typecheck failed' \"$log\" && echo FAIL || echo PASS)
Migrate: $(grep -qi 'migrate status failed' \"$log\" && echo FAIL || echo PASS)
FFmpeg: $(grep -qi 'ffmpeg missing' \"$log\" && echo FAIL || echo PASS)
Dev port: ${port:-unknown}
Health: $(grep -qi 'health route not reachable' \"$log\" && echo FAIL || echo PASS)
Tests: $(grep -qi 'tests failed or not configured' \"$log\" && echo FAIL || echo PASS)
Vercel: $(grep -A1 '^## Vercel' \"$log\" | grep -qi 'not linked\|not configured' && echo FAIL || echo PASS)
Report: $log"
