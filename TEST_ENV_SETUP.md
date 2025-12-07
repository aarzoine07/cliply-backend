# Test Environment Setup

This document explains how to configure your local environment for running Vitest tests.

## Quick Start

1. Copy the template below to create a `.env.test` file in the repository root
2. Fill in the required Supabase credentials
3. Run tests: `pnpm test`

## Required Environment Variables

The following environment variables **must** be set in `.env.test` for tests to run:

### Supabase (Required)

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**For local development:**
- Use your actual Supabase test project credentials, OR
- Run a local Supabase instance: `npx supabase start`
- Local Supabase typically runs at `http://localhost:54321`

**For unit tests without real DB:**
- You can use placeholder values if tests are mocked/stubbed
- Warning will be shown but tests may still pass if they don't require real DB

## Optional Environment Variables

These are auto-mocked or optional depending on what you're testing:

### Stripe (Auto-mocked if not provided)

```bash
STRIPE_SECRET_KEY=sk_test_your_stripe_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret
```

**Note:** If not provided, `STRIPE_SECRET_KEY` is automatically set to `sk_test_mock_key_for_tests` in test setup.

### Database URL (Optional)

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres
```

Only needed if running real database integration tests.

### External Services (Optional)

Only needed if testing specific integrations:

```bash
# AI Services
OPENAI_API_KEY=
DEEPGRAM_API_KEY=

# TikTok OAuth
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=
TIKTOK_OAUTH_REDIRECT_URL=
TIKTOK_TOKEN_URL=
TIKTOK_ENCRYPTION_KEY=

# YouTube/Google OAuth
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_OAUTH_REDIRECT_URL=

# Cron & Automation
CRON_SECRET=test-cron-secret
VERCEL_AUTOMATION_BYPASS_SECRET=test-bypass-secret

# Sentry (usually disabled in tests)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
```

## How It Works

1. **Vitest config** (`vitest.config.ts`) specifies `setupFiles: ["packages/shared/test/setup.ts"]`
2. **Test setup** (`packages/shared/test/setup.ts`) loads `.env.test` using `dotenv.config()`
3. **Env validation** (`packages/shared/src/env.ts`) validates loaded env vars using Zod schema
4. Tests run with validated environment

## File Location

- `.env.test` must be in the **repository root** (same level as `package.json`)
- `.env.test` is gitignored (covered by `.env.*` in `.gitignore`)
- **Never commit** `.env.test` with real credentials

## Troubleshooting

### Error: "Environment variable validation failed"

```
SUPABASE_URL: Invalid input: expected string, received undefined
```

**Solution:** Create `.env.test` file with required Supabase credentials (see above).

### Warning: "SUPABASE env missing in test setup (local dev)"

This warning is shown if Supabase credentials are missing in local (non-CI) environment.
- Tests may still pass if they're mocked
- To remove warning, add valid Supabase credentials to `.env.test`
- In CI (`CI=true`), this becomes a hard failure

### Tests import packages/shared modules but fail

If you see module resolution errors like `Cannot find package '@cliply/shared/billing/planMatrix'`:
- Run `pnpm --filter @cliply/shared build` to ensure shared package is built
- Check that `packages/shared/dist/src/` contains `.js` files, not just `.d.ts`

## Running Tests

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test test/api/billing.status.test.ts --run

# Watch mode
pnpm test:watch

# With coverage
pnpm test:coverage
```

## Complete .env.test Template

```bash
# ────────────────────────────────────────────────────────────────────────────
# Required: Supabase
# ────────────────────────────────────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here

# ────────────────────────────────────────────────────────────────────────────
# Optional: Database
# ────────────────────────────────────────────────────────────────────────────
DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres

# ────────────────────────────────────────────────────────────────────────────
# Optional: Stripe (auto-mocked if not provided)
# ────────────────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=sk_test_your_stripe_test_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# ────────────────────────────────────────────────────────────────────────────
# Optional: External Services
# ────────────────────────────────────────────────────────────────────────────
OPENAI_API_KEY=
DEEPGRAM_API_KEY=
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=
TIKTOK_OAUTH_REDIRECT_URL=
TIKTOK_TOKEN_URL=
TIKTOK_ENCRYPTION_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
YOUTUBE_OAUTH_REDIRECT_URL=
CRON_SECRET=test-cron-secret
VERCEL_AUTOMATION_BYPASS_SECRET=test-bypass-secret
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# ────────────────────────────────────────────────────────────────────────────
# Environment
# ────────────────────────────────────────────────────────────────────────────
NODE_ENV=test
```

