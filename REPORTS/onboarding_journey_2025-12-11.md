# Onboarding Journey – 2025-12-11

## Executive Summary

**COMPLETE PAYING USER ONBOARDING FLOW**: This document describes the end-to-end journey from brand-new user account creation through Stripe subscription checkout, social media account connection, and first video upload entering the engine pipeline. All components are implemented and tested using the existing codebase on `engine-surface-setup` branch.

The flow involves 5 main phases: account/workspace setup → plan upgrade via Stripe → billing status confirmation → social account connection → video upload to engine pipeline.

## 1. Starting state – new user & workspace

### User Account Creation
- **How users are created**: Users authenticate via Supabase Auth (email/password or OAuth providers)
- **Authentication flow**: Uses `buildAuthContext()` from `@cliply/shared/auth/context`
- **Debug mode**: Test environments support `x-debug-user` and `x-debug-workspace` headers for manual testing
- **Real production flow**: Requires valid Supabase JWT tokens in Authorization header

### Workspace Creation & Membership
- **Workspace concept**: Each user belongs to workspaces (multi-tenant support)
- **Default workspace**: Users must specify `x-workspace-id` header for all API calls
- **Membership verification**: `workspace_members` table ensures user has access to workspace
- **Starting plan**: **All new workspaces default to "basic" plan** (free tier)
- **Default limits**: 5 uploads/day, 3 clips/project, 1 team member, 15GB storage, 2 concurrent jobs

### Initial Billing State
- **No subscription record**: Free workspaces have no entry in `subscriptions` table
- **Plan resolution**: `resolveWorkspacePlan()` falls back to "basic" for workspaces without active subscriptions
- **Billing status**: "free" with no trial, no current period end
- **Usage tracking**: All metrics start at zero (projects: 0, clips: 0, posts: 0, minutes: 0)

## 2. Upgrading to a paid plan (Stripe checkout)

### Checkout Initiation
- **API endpoint**: `POST /api/billing/checkout`
- **Input requirements**:
  ```json
  {
    "priceId": "price_1SPALSJ2vBRZZMLQjM9eLBkf",  // pro plan example
    "successUrl": "https://app.cliply.com/success",
    "cancelUrl": "https://app.cliply.com/cancel"
  }
  ```
- **Price ID validation**: Must exist in `STRIPE_PLAN_MAP` (basic/pro/premium)
- **Plan mapping**: `price_1SPAJQJ2vBRZZMLQFeAuYJK5` → basic, `price_1SPALSJ2vBRZZMLQjM9eLBkf` → pro, `price_1SPAM7J2vBRZZMLQQaPkyiEW` → premium

### Stripe Session Creation
- **Session mode**: "subscription" (recurring billing)
- **Metadata**: Includes `workspace_id` for webhook processing
- **Success response**:
  ```json
  {
    "ok": true,
    "checkoutUrl": "https://checkout.stripe.com/pay/cs_test_...",
    "sessionId": "cs_test_...",
    "idempotent": false
  }
  ```
- **User experience**: Redirected to Stripe hosted checkout page, completes payment

### Webhook Processing
- **Webhook endpoint**: `POST /api/webhooks/stripe`
- **Supported events**:
  - `checkout.session.completed`: Creates subscription record
  - `customer.subscription.created/updated/deleted`: Updates subscription state
  - `invoice.payment_succeeded/failed`: Tracks payment status

### Database Updates
- **Subscription record**: Inserted into `subscriptions` table with:
  - `workspace_id`: Links to user's workspace
  - `plan_name`: "basic", "pro", or "premium"
  - `price_id`: Original Stripe price ID
  - `status`: "active", "trialing", etc.
  - `stripe_customer_id`, `stripe_subscription_id`: Stripe identifiers

- **Workspace plan update**: `setWorkspacePlan()` updates workspace.plan field
- **Audit logging**: All billing events logged to audit trail

### Plan Resolution After Upgrade
- **Plan detection**: `resolveWorkspacePlan()` now finds active subscription
- **Priority logic**: Uses most recent subscription by `current_period_end`
- **Fallback behavior**: Still falls back to "basic" if subscription queries fail

## 3. Billing status & usage after upgrade

### Status Endpoint
- **API**: `GET /api/billing/status`
- **Response includes**:
  - **Plan info**: `tier` ("pro"), `billingStatus` ("active"), `trial` (active/duration if applicable)
  - **Usage metrics**: Current usage vs limits for minutes, clips, projects, posts
  - **Limit flags**: `softLimit` (true if any metric >80% of limit), `hardLimit` (true if any metric at limit)

### Usage Endpoint
- **API**: `GET /api/billing/usage`
- **Response**: Same usage metrics as status endpoint, without plan info
- **Use case**: Lightweight polling for quota displays

### Usage Tracking Integration
- **Real-time calculation**: `getWorkspaceUsageSummary()` combines plan limits + actual usage
- **Monthly periods**: Usage resets monthly, tracked by `period_start` in database
- **Metrics tracked**: `source_minutes`, `clips`, `projects`, `posts`
- **Limit enforcement**: Uploads, clips, publishing all check usage before proceeding

## 4. Connecting TikTok and YouTube

### OAuth Initiation
- **TikTok flow**: `GET /api/oauth/tiktok/start` → redirects to TikTok OAuth
- **YouTube flow**: `GET /api/oauth/google/start` → redirects to Google OAuth (with YouTube scopes)
- **Requirements**: Valid user session + workspace_id
- **OAuth configuration**: Requires `TIKTOK_CLIENT_ID`, `GOOGLE_CLIENT_ID`, etc. in environment

### OAuth Callback Processing
- **TikTok callback**: `GET /api/oauth/tiktok/callback` processes authorization code
- **YouTube callback**: `GET /api/oauth/google/callback` processes authorization code
- **Token exchange**: Converts authorization code to access/refresh tokens
- **Account storage**: Creates/updates `connected_accounts` records

### Connected Account Data
- **Database storage**: `connected_accounts` table stores:
  - `workspace_id`: Links to user's workspace
  - `platform`: "tiktok" or "youtube"
  - `external_id`: Platform account identifier
  - `access_token`, `refresh_token`: OAuth credentials
  - `expires_at`: Token expiration timestamp
- **API access**: `/api/accounts` endpoints list/manage connected accounts
- **Publishing requirement**: Publishing endpoints require active connected accounts

## 5. Uploading the first video and entering the engine pipeline

### Upload Initiation
- **API endpoint**: `POST /api/upload/init`
- **Plan gating**: Checks `uploads_per_day` limit before proceeding
- **Usage validation**: Validates against `projects` and `source_minutes` quotas
- **Rate limiting**: Prevents abuse with per-user upload rate limits

### Upload Flow Options
- **File upload**: `{ "source": "file", "filename": "video.mp4", "size": 1024000, "mime": "video/mp4" }`
- **YouTube import**: `{ "source": "youtube", "url": "https://youtube.com/watch?v=..." }`

### Storage & Project Creation
- **Project record**: Created in `projects` table with:
  - `workspace_id`: User's workspace
  - `source_type`: "file" or "youtube"
  - `source_path`: Storage location or YouTube URL
  - `status`: "queued" (ready for processing)
- **Storage path**: `videos/{workspace_id}/{project_id}/source.{ext}`

### Engine Pipeline Entry
- **File uploads**: `/api/upload/complete` enqueues `TRANSCRIBE` job
- **YouTube imports**: Automatically enqueues `YOUTUBE_DOWNLOAD` job
- **Job creation**: All jobs include `workspace_id` for plan gating

### Pipeline Stages (from engine tests)
1. **Download/Import**: Fetch video from storage or YouTube
2. **Transcribe**: Convert audio to text captions
3. **Highlight Detection**: Identify key moments/clips
4. **Clip Rendering**: Generate video clips
5. **Publishing**: Post to connected TikTok/YouTube accounts

### Plan & Usage Checks Throughout
- **Concurrent jobs**: Pipeline respects `concurrent_jobs` plan limits
- **Posting limits**: Publishing checks `posts_per_month` quotas
- **Clip limits**: `clips_per_month` enforced during rendering
- **Anti-spam guards**: Publishing includes rate limiting and duplicate prevention

## 6. Summary checklist for 'paying customer ready to clip'

✅ **User account exists** (Supabase Auth user with valid JWT)
✅ **Workspace membership** (user belongs to workspace via workspace_members)
✅ **Active paid subscription** (subscription record exists, status="active")
✅ **Plan resolved correctly** (/api/billing/status shows paid tier with limits)
✅ **Usage tracking active** (/api/billing/usage shows current metrics vs limits)
✅ **Connected accounts** (/api/accounts lists TikTok/YouTube with valid tokens)
✅ **Upload permissions** (plan allows uploads, usage under limits)
✅ **First upload accepted** (upload:init succeeds, creates project record)
✅ **Pipeline entry** (upload:complete enqueues jobs, plan gates pass)
✅ **Engine processing** (jobs enter pipeline stages with workspace context)

**Ready for automated clipping**: User can now upload videos that will be processed by the complete engine pipeline, respecting all plan limits and posting to connected social accounts.