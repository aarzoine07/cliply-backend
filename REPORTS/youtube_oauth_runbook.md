# YouTube OAuth (Google) — Canonical Flow Runbook

## Canonical vs Legacy Routes

### Canonical (production)
- **Callback (App Router):** `apps/web/src/app/api/auth/youtube/callback/route.ts`
  - Receives: `GET /api/auth/youtube/callback?code=<code>&state=<state>`
  - Decodes `state` (base64url JSON) → `{ workspaceId, userId }`
  - Uses `YOUTUBE_OAUTH_REDIRECT_URL` from `@cliply/shared/env`
  - Completes flow via `completeYouTubeOAuthFlow(...)` which:
    - Exchanges code → tokens
    - Fetches channel info
    - Persists `connected_accounts` (upsert)

### Legacy (dev-only)
- **Start (Pages Router):** `apps/web/src/pages/api/oauth/google/start.ts`
  - Generates OAuth URL via `buildYouTubeAuthUrl(...)`
  - Enforces a single redirect URI:
    - If `redirect_uri` query param is provided and does not match configured `YOUTUBE_OAUTH_REDIRECT_URL`, request is rejected (400).

- **Callback (Pages Router):** `apps/web/src/pages/api/oauth/google/callback.ts`
  - Marked DEV-ONLY / legacy.
  - Uses the same service layer (`completeYouTubeOAuthFlow`) and same env source (`YOUTUBE_OAUTH_REDIRECT_URL`).

## Required Env
These must exist in the environment used by the web app:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `YOUTUBE_OAUTH_REDIRECT_URL`
- (Server admin persistence) `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`

## Manual End-to-End Validation Checklist

### 1) Confirm redirect URI is consistent
- Confirm `YOUTUBE_OAUTH_REDIRECT_URL` matches exactly what’s registered in Google Cloud Console as an Authorized redirect URI.
- Confirm the start endpoint cannot be tricked into using a different redirect URI (mismatch should 400).

### 2) Confirm start endpoint generates a valid state payload
- Trigger the start endpoint through the app (must be authenticated because it uses auth context).
- The returned URL must include `state=...`
- Decode `state` (base64url JSON) and confirm it contains:
  - `workspaceId`
  - `userId`

### 3) Complete OAuth in browser
- Visit the returned OAuth URL, complete consent.
- Google redirects back to the canonical callback:
  - `GET /api/auth/youtube/callback?code=...&state=...`

### 4) Verify connected_accounts persistence
- Confirm a row exists/updates in `public.connected_accounts` for:
  - `workspace_id = <workspaceId>`
  - `platform = 'youtube'`
  - `provider = 'google'`
  - `external_id = <youtube channel id>`
- Confirm status is active/expected and expiry/scopes are populated (as implemented by service layer).

### 5) Confirm expected redirect after callback
- Callback should redirect to:
  - `/integrations?connected=youtube`
- OAuth errors should redirect with:
  - `/integrations?error=youtube_auth_failed` (oauth error param)
  - `/integrations?error=youtube_unexpected` (unexpected server error)
