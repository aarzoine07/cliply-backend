# Stripe Environment Setup

## ✅ Completed (Automated)

### Environment Variables Added
The following variables have been added to `apps/web/.env.local`:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_BASIC=price_1SPAJQJ2vBRZZMLQFeAuYJK5
STRIPE_PRICE_PRO=price_1SPALSJ2vBRZZMLQjM9eLBkf
STRIPE_PRICE_PREMIUM=price_1SPAM7J2vBRZZMLQQaPkyiEW
APP_URL=http://localhost:3000
```

**Note**: Price IDs are already configured in codebase (`packages/shared/billing/stripePlanMap.ts`) and match the values above.

### Database Tables Verified
✅ `subscriptions` table exists in schema (migration: `20251020043717_remote_schema.sql`)
- Contains: `workspace_id`, `stripe_customer_id`, `stripe_subscription_id`, `plan_name`, `price_id`, `status`, etc.
- RLS enabled

### Webhook Endpoint Verified
✅ Webhook handler exists at: `apps/web/src/pages/api/webhooks/stripe.ts`
- Handles: `checkout.session.completed`, `customer.subscription.*`, `invoice.payment_*`

---

## 🔧 Manual Steps Required (Stripe Dashboard)

### Step 1: Get Stripe Secret Key
1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **API keys**
2. Copy your **Secret key** (starts with `sk_test_` for test mode, `sk_live_` for production)
3. Update `apps/web/.env.local`:
   ```bash
   STRIPE_SECRET_KEY=sk_test_YOUR_ACTUAL_KEY_HERE
   ```

### Step 2: Get Webhook Signing Secret
1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Developers** → **Webhooks**
2. Find or create webhook endpoint pointing to: `https://YOUR_DOMAIN/api/webhooks/stripe`
3. Click on the webhook endpoint
4. Copy the **Signing secret** (starts with `whsec_`)
5. Update `apps/web/.env.local`:
   ```bash
   STRIPE_WEBHOOK_SECRET=whsec_YOUR_ACTUAL_SECRET_HERE
   ```

### Step 3: Verify Webhook Endpoint Configuration
1. In Stripe Dashboard → **Developers** → **Webhooks**
2. Ensure endpoint URL is: `https://YOUR_DOMAIN/api/webhooks/stripe`
   - For local dev: Use Stripe CLI (`stripe listen --forward-to localhost:3000/api/webhooks/stripe`)
   - For production: Use your Vercel/deployed URL
3. Verify these events are enabled:
   - ✅ `checkout.session.completed`
   - ✅ `customer.subscription.created`
   - ✅ `customer.subscription.updated`
   - ✅ `customer.subscription.deleted`
   - ✅ `invoice.payment_succeeded`
   - ✅ `invoice.payment_failed`

### Step 4: Verify Price IDs (Optional)
If you need to verify price IDs match your Stripe products:
1. Go to [Stripe Dashboard](https://dashboard.stripe.com) → **Products**
2. Verify these Price IDs exist:
   - Basic: `price_1SPAJQJ2vBRZZMLQFeAuYJK5`
   - Pro: `price_1SPALSJ2vBRZZMLQjM9eLBkf`
   - Premium: `price_1SPAM7J2vBRZZMLQQaPkyiEW`

---

## ✅ Verification

### Verify Environment Variables
```bash
cd /Users/davidmaman/Desktop/cliply-backend
./scripts/verify-stripe-env.sh
```

**Expected Success Output:**
```
🔍 Verifying Stripe environment configuration...

✅ All required Stripe environment variables are present and configured

Configured variables:
  STRIPE_SECRET_KEY=sk_test_...
  STRIPE_WEBHOOK_SECRET=whsec_...
  STRIPE_PRICE_BASIC=price_1SPAJQJ2vBRZZMLQFeAuYJK5
  STRIPE_PRICE_PRO=price_1SPALSJ2vBRZZMLQjM9eLBkf
  STRIPE_PRICE_PREMIUM=price_1SPAM7J2vBRZZMLQQaPkyiEW
  APP_URL=http://localhost:3000
```

### Verify Database Tables
```bash
# Connect to Supabase and verify subscriptions table exists
# Or check migration file:
grep -A 15 'create table "public"."subscriptions"' supabase/migrations/20251020043717_remote_schema.sql
```

### Verify Webhook Endpoint
1. Check Stripe Dashboard → **Developers** → **Webhooks**
2. Confirm endpoint shows as **Active** (green status)
3. Test with Stripe CLI (local):
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   stripe trigger checkout.session.completed
   ```

---

## 📋 Acceptance Criteria Checklist

- [x] `.env.local` contains `STRIPE_SECRET_KEY` (placeholder added, needs real value)
- [x] `.env.local` contains `STRIPE_WEBHOOK_SECRET` (placeholder added, needs real value)
- [x] `.env.local` contains `STRIPE_PRICE_BASIC`
- [x] `.env.local` contains `STRIPE_PRICE_PRO`
- [x] `.env.local` contains `STRIPE_PRICE_PREMIUM`
- [x] `.env.local` contains `APP_URL`
- [ ] **MANUAL**: Stripe Dashboard shows active endpoint `/api/webhooks/stripe` (verify in dashboard)

---

## 🚨 Failure Recovery

If verification fails:

1. **Missing env vars**: Run `./scripts/verify-stripe-env.sh` to identify missing variables
2. **Placeholder values**: Update `apps/web/.env.local` with actual values from Stripe Dashboard
3. **Webhook not active**: 
   - Check endpoint URL matches exactly: `/api/webhooks/stripe`
   - Verify webhook secret matches the one in Stripe Dashboard
   - Check webhook events are enabled
4. **Database tables missing**: Run migrations:
   ```bash
   # Apply migrations if needed
   supabase migration up
   ```

---

## 📝 Notes

- Price IDs are hardcoded in `packages/shared/billing/stripePlanMap.ts` and match the env vars
- The `subscriptions` table stores customer info (no separate `billing_customers` table needed)
- Webhook endpoint path: `/api/webhooks/stripe` (Next.js Pages API route)
- For local development, use Stripe CLI to forward webhooks to localhost

