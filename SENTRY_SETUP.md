# Sentry Integration Setup

## Overview

Sentry is configured for error monitoring across both `apps/web` (Next.js) and `apps/worker` (Node.js job runner).

**Project**: cliply / javascript-nextjs  
**DSN**: `https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376`  
**Dashboard**: https://cliply.sentry.io/issues/?project=4510297116901376

## Configuration Files

### Web App (Next.js)

- `apps/web/sentry.server.config.ts` - Server-side error tracking (API routes)
- `apps/web/sentry.edge.config.ts` - Edge runtime error tracking (middleware)
- `apps/web/src/instrumentation-client.ts` - Client-side error tracking (browser)

### Worker App

- `packages/shared/src/sentry.ts` - Shared Sentry initialization (used by worker)
- `apps/worker/src/worker.ts` - Calls `initSentry("worker")` on boot

## Setup Instructions

### 1. Add Environment Variable

Create `.env.local` in the project root:

```bash
echo "SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376" >> .env.local
```

### 2. Verify Packages (Already Installed)

```bash
pnpm list @sentry/nextjs @sentry/node
```

**Installed versions:**
- `@sentry/nextjs@10.22.0` (web)
- `@sentry/node@8.42.0` (worker)

### 3. Verify Configuration

```bash
npx tsx scripts/verify-sentry.ts
```

**Expected output:**
```
✅ All Sentry configuration checks passed!
  ✓ Web server config: DSN from env
  ✓ Web edge config: DSN from env
  ✓ Web client config: DSN from env
  ✓ Shared config: DSN from env
  ✓ Worker: initSentry called on boot
  ✓ Worker: captureError used in error handlers
```

### 4. Start Development Server

```bash
pnpm dev
```

**Expected logs:**
```
[Web] Sentry initialized (env: development)
[Web/Edge] Sentry initialized (env: development)
[Web/Client] Sentry initialized (env: development)
Sentry initialized (env: worker)
```

## Testing

### Web Error Testing

1. Visit: http://localhost:3000/sentry-example-page
2. Click "Throw Sample Error"
3. Check dashboard for events

### API Error Testing

```bash
curl http://localhost:3000/api/sentry-example-api
```

### Worker Error Testing

Worker errors are automatically captured via:
- `captureError()` in uncaughtException handlers
- `captureError()` in unhandledRejection handlers
- Job failure handlers

## Features

### Error Filtering

**4xx Client Errors**: Filtered out (not sent to Sentry)

```typescript
beforeSend(event, hint) {
  const error = hint.originalException;
  if (error?.statusCode >= 400 && error?.statusCode < 500) {
    return null; // Don't send to Sentry
  }
  return event;
}
```

### Context Enrichment

- `environment`: Automatically set from `NODE_ENV`
- `workspace_id`: Included in worker error context
- `service`: Tagged as "api" or "worker"

### Sample Rate

- `tracesSampleRate: 1.0` (100% in development)
- Adjust in production for cost optimization

## Alert Configuration

**Manual dashboard setup required:**

1. Navigate to: https://cliply.sentry.io/alerts/
2. Create Alert Rule:
   - **Condition**: When the number of errors is above 5 in 1 minute
   - **Action**: Send to email or Slack
3. Test via "Send Test Notification"

## Troubleshooting

### "Sentry DSN not configured"

**Solution**: Ensure `.env.local` exists with `SENTRY_DSN` set

```bash
# Check if env file exists
cat .env.local | grep SENTRY_DSN

# If missing, add it:
echo "SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376" >> .env.local
```

### No events in dashboard

1. Check console logs for "Sentry initialized"
2. Verify DSN is correct
3. Check network tab for blocked requests (ad-blockers)
4. Visit `/sentry-example-page` to trigger test error

### Worker not sending errors

1. Check worker logs: `Sentry initialized (env: worker)`
2. Verify `initSentry("worker")` is called at top of `worker.ts`
3. Check that `@cliply/shared` is built: `pnpm --filter @cliply/shared build`

## Production Deployment

### Environment Variables

Set in your hosting platform:

```bash
SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376
NODE_ENV=production
```

### Sample Rate Adjustment

Reduce `tracesSampleRate` in production:

```typescript
tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0
```

### Source Maps

Next.js automatically uploads source maps via `@sentry/nextjs` webpack plugin (configured in `next.config.js`).

## Verification Command

```bash
npx tsx scripts/verify-sentry.ts
```

This script validates:
- ✓ All config files use `process.env.SENTRY_DSN`
- ✓ Worker calls `initSentry()` and `captureError()`
- ✓ 4xx error filtering is enabled
- ✓ Test endpoints are accessible

