# Environment Variables

## Required Environment Variables

Create a `.env.local` file in the root directory with the following variables:

### Sentry Configuration

```bash
# Sentry DSN for error monitoring (web + worker)
SENTRY_DSN=https://717342b79cb5df4b2951ca4f0eabdcfa@o4510297114279936.ingest.us.sentry.io/4510297116901376
```

**Note**: The same DSN is used for both `apps/web` and `apps/worker`.

### Supabase Configuration

```bash
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
```

### Stripe Configuration

```bash
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
```

### Other Configuration

```bash
NODE_ENV=development
```

## Environment-Specific Files

- `.env.local` - Local development (git-ignored)
- `.env.production` - Production environment (git-ignored)
- `.env.test` - Test environment (Sentry disabled)

## Testing Sentry Integration

1. Add `SENTRY_DSN` to your `.env.local`
2. Start the dev server: `pnpm dev`
3. Visit test endpoints:
   - Web UI: `http://localhost:3000/sentry-example-page`
   - API: `http://localhost:3000/api/sentry-example-api`
4. Check Sentry dashboard: https://cliply.sentry.io/issues/?project=4510297116901376

