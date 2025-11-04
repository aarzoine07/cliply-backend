# Environment Variables

## Required Environment Variables

Create a `.env.local` file in `apps/web/` directory with the following variables:

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
# Stripe Secret Key (from Stripe Dashboard → Developers → API keys)
STRIPE_SECRET_KEY=your_stripe_secret_key

# Stripe Webhook Signing Secret (from Stripe Dashboard → Developers → Webhooks)
STRIPE_WEBHOOK_SECRET=whsec_CvNXrbLsN6SD5HW3Mc9WAq98ced4iCDV
```

#### Stripe Products & Prices

The following Stripe products have been configured:

| Plan | Price | Price ID |
|------|-------|----------|
| **Cliply Basic** | $25/month | `price_1SPAJQJ2vBRZZMLQFeAuYJK5` |
| **Cliply Pro** | $50/month | `price_1SPALSJ2vBRZZMLQjM9eLBkf` |
| **Cliply Premium** | $100/month | `price_1SPAM7J2vBRZZMLQQaPkyiEW` |

**Webhook Endpoint**: `https://cliply-backend-web-m7a4.vercel.app/api/stripe/webhook`

**Webhook Events Monitored**:
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

### Application URLs

```bash
# Your application's public URL (used for Stripe checkout redirects)
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Other Configuration

```bash
NODE_ENV=development
```

## Environment-Specific Files

- `apps/web/.env.local` - Local development (git-ignored)
- `apps/web/.env.production` - Production environment (git-ignored)
- `apps/web/.env.test` - Test environment (Sentry disabled)
- `apps/web/.env.example` - Template with all required variables

## Testing Sentry Integration

1. Add `SENTRY_DSN` to your `.env.local`
2. Start the dev server: `pnpm dev`
3. Visit test endpoints:
   - Web UI: `http://localhost:3000/sentry-example-page`
   - API: `http://localhost:3000/api/sentry-example-api`
4. Check Sentry dashboard: https://cliply.sentry.io/issues/?project=4510297116901376

## Testing Stripe Integration

### Test Checkout Flow

```bash
curl -X POST http://localhost:3000/api/billing/checkout \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "priceId": "price_1SPAJQJ2vBRZZMLQFeAuYJK5",
    "successUrl": "http://localhost:3000/billing/success",
    "cancelUrl": "http://localhost:3000/billing/cancel"
  }'
```

### Test Webhook Locally

Use Stripe CLI to forward webhook events to your local server:

```bash
stripe listen --forward-to localhost:3000/api/stripe/webhook
stripe trigger checkout.session.completed
```

## Plan Feature Matrix

| Feature | Basic | Pro | Premium |
|---------|-------|-----|---------|
| **Price** | $25/mo | $50/mo | $100/mo |
| **Uploads/day** | 5 | 30 | 150 |
| **Clips/project** | 3 | 12 | 40 |
| **Team members** | 1 | 5 | 15 |
| **Storage** | 15 GB | 80 GB | 250 GB |
| **Concurrent jobs** | 2 | 6 | 15 |
| **Scheduled publishing** | ❌ | ✅ | ✅ |
| **AI titles** | ❌ | ✅ | ✅ |
| **AI captions** | ❌ | ✅ | ✅ |
| **Watermark-free exports** | ❌ | ✅ | ✅ |
| **Trial period** | 7 days | 7 days | 14 days |

