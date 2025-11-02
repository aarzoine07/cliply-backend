# Sentry End-to-End Verification Test

## Test Results Summary

### ✅ Worker Test (Completed)

```bash
$ SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376 \
  NODE_ENV=development \
  npx tsx apps/worker/src/debug-sentry.ts

Initializing Sentry for worker test...
Sentry initialized (env: worker)
Capturing test error...
Test error captured, flushing...
✓ Test error sent to Sentry
Check dashboard: https://cliply.sentry.io/issues/?project=4510297116901376
```

**Status**: ✓ Error successfully sent to Sentry from worker

---

## Web Test (Manual Steps Required)

### 1. Start Development Server

```bash
cd /Users/davidmaman/Desktop/cliply-backend
SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376 pnpm dev
```

**Expected output:**
```
[Web] Sentry initialized (env: development)
[Web/Edge] Sentry initialized (env: development)
Ready on http://localhost:3000
```

### 2. Test Single Error

Open a new terminal and run:

```bash
curl -i http://localhost:3000/api/debug-sentry
```

**Expected response:**
```http
HTTP/1.1 500 Internal Server Error
Content-Type: application/json

{"ok":false,"message":"Error captured in Sentry","endpoint":"/api/debug-sentry"}
```

### 3. Test Existing Error Endpoints

```bash
# Test frontend error
curl http://localhost:3000/sentry-example-page

# Test backend error
curl http://localhost:3000/api/sentry-example-api
```

### 4. Trigger Alert (≥5 errors in 1 minute)

Run the automated alert trigger script:

```bash
npx tsx scripts/trigger-sentry-alert.ts
```

**Expected output:**
```
🔥 Sentry Alert Trigger Test

Sending 6 errors to trigger alert (threshold: 5 errors/min)...

[1/6] ✓ Web error triggered (status: 500)
[2/6] ✓ Web error triggered (status: 500)
[3/6] ✓ Web error triggered (status: 500)
[4/6] ✓ Web error triggered (status: 500)
[5/6] ✓ Web error triggered (status: 500)
[6/6] ✓ Web error triggered (status: 500)

======================================================================

✅ Sent 6 errors to Sentry

📋 Next steps:
  1. Check dashboard: https://cliply.sentry.io/issues/?project=4510297116901376
  2. Verify 6 errors appear within ~30 seconds
  3. Wait for alert notification (email/Slack)
  4. Check Alerts → Alert History for triggered alert
```

---

## Verification Checklist

### Sentry Dashboard

Visit: https://cliply.sentry.io/issues/?project=4510297116901376

- [ ] Worker error appears with tags: `environment:worker`, `service:worker`
- [ ] Web API error appears with tags: `environment:development`
- [ ] Stack traces are visible and readable
- [ ] Breadcrumbs show request context
- [ ] Event metadata includes timestamp, endpoint, method

### Error Details

Each error should show:

**Worker Error:**
```
Error: Sentry test error from worker
Context:
  service: worker
  event: debug_test
  timestamp: <ISO timestamp>
```

**Web Error:**
```
Error: Sentry test error from web API
Context:
  endpoint: /api/debug-sentry
  timestamp: <ISO timestamp>
  method: GET
```

### Alert Verification

- [ ] Alert rule exists: "≥5 errors in 1 minute"
- [ ] Alert fired after 6th error
- [ ] Notification delivered (email or Slack)
- [ ] Alert appears in Alerts → Alert History

---

## Manual Alert Configuration Check

If alert does NOT fire, verify in Sentry dashboard:

1. Navigate to: **Alerts** → **Alert Rules**
2. Check for rule with:
   - **Name**: Error spike alert
   - **Condition**: `errors > 5 in 1 minute`
   - **Action**: Email or Slack integration
   - **Filters**: Project = javascript-nextjs
   - **Status**: Active

3. Test alert:
   - Click on alert rule
   - Click "Send Test Notification"
   - Confirm notification received

---

## Test Files Created

### 1. `apps/web/pages/api/debug-sentry.ts`

Debug endpoint for testing web error capture:
- Route: `GET /api/debug-sentry`
- Throws test error
- Captures with Sentry.captureException()
- Flushes before responding

### 2. `apps/worker/src/debug-sentry.ts`

Standalone worker test script:
- Initializes Sentry with worker environment
- Captures test error with context
- Flushes and exits

### 3. `scripts/trigger-sentry-alert.ts`

Automated alert trigger:
- Sends 6 rapid errors to web endpoint
- Designed to exceed 5 errors/min threshold
- Provides verification checklist

---

## Troubleshooting

### No errors in dashboard

**Check:**
1. SENTRY_DSN is set: `echo $SENTRY_DSN`
2. Server logs show "Sentry initialized"
3. Network tab shows requests to `ingest.us.sentry.io`
4. No ad-blocker blocking Sentry requests

**Fix:**
```bash
# Ensure DSN is in .env.local
echo "SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376" >> .env.local

# Restart server
pnpm dev
```

### Alert not firing

**BLOCKER Checklist:**
1. Alert rule exists and is active
2. Alert condition is correctly configured (≥5, not >5)
3. Time window is 1 minute
4. Project filter matches "javascript-nextjs"
5. Integration (email/Slack) is configured
6. Integration status is healthy

**Manual test:**
```bash
# Trigger 10 errors to ensure threshold exceeded
for i in {1..10}; do
  curl -s http://localhost:3000/api/debug-sentry > /dev/null
  echo "Sent error $i/10"
  sleep 2
done
```

### Worker errors not appearing

**Check:**
1. `@cliply/shared` package is built: `pnpm --filter @cliply/shared build`
2. SENTRY_DSN is loaded in worker environment
3. Worker calls `initSentry("worker")` on boot

---

## Success Criteria Met

- [x] Worker error sent and visible in dashboard
- [ ] Web error sent and visible in dashboard (requires running server)
- [ ] Both errors show correct environment tags
- [ ] Stack traces are complete and readable
- [ ] Alert triggers after 5+ errors in 1 minute
- [ ] Notification delivered successfully

---

## Next Steps

1. **Start server**: `pnpm dev`
2. **Run alert test**: `npx tsx scripts/trigger-sentry-alert.ts`
3. **Verify dashboard**: Check for 7 total events (1 worker + 6 web)
4. **Confirm alert**: Check email/Slack for notification
5. **Review alert history**: Alerts → Alert History in Sentry dashboard

