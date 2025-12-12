# Stripe Plan Matrix Alignment Report – 2025-12-11

## Executive Summary

**✅ ALIGNMENT STATUS: FULLY ALIGNED**

All billing and plan-related code in the Cliply backend is properly synchronized:

- **PLAN_MATRIX** defines 3 plan tiers: `basic`, `pro`, `premium`
- **STRIPE_PLAN_MAP** maps 3 Stripe price IDs to these same plan names
- **Plan resolution logic** works with these plan names
- **Billing endpoints** use consistent plan names
- **Tests** pass with aligned plan expectations

No changes were needed - the codebase is already in good alignment.

## Plan Matrix Overview

| Plan Name | Stripe Price ID | Key Limits | Features |
|-----------|-----------------|------------|----------|
| `basic` | `price_1SPAJQJ2vBRZZMLQFeAuYJK5` | 5 uploads/day, 3 clips/project, 1 team member, 15GB storage, 2 concurrent jobs | No AI features, no scheduling, watermark required |
| `pro` | `price_1SPALSJ2vBRZZMLQjM9eLBkf` | 30 uploads/day, 12 clips/project, 5 team members, 80GB storage, 6 concurrent jobs | AI titles/captions, scheduling enabled, no watermark |
| `premium` | `price_1SPAM7J2vBRZZMLQQaPkyiEW` | 150 uploads/day, 40 clips/project, 15 team members, 250GB storage, 15 concurrent jobs | All AI features, scheduling, no watermark |

## Alignment Verification

### ✅ PLAN_MATRIX (Source of Truth)
- Located: `packages/shared/src/billing/planMatrix.ts`
- Defines: `basic`, `pro`, `premium` plans with limits and features
- Used by: Plan gating, usage tracking, billing endpoints

### ✅ STRIPE_PLAN_MAP
- Located: `packages/shared/src/billing/stripePlanMap.ts`
- Maps all 3 Stripe price IDs to corresponding plan names
- Used by: Checkout validation, webhook processing

### ✅ Plan Resolution
- Located: `packages/shared/src/billing/planResolution.ts`
- Resolves workspace plans from subscriptions to: `basic`, `pro`, `premium`
- Falls back to `basic` for free/unsubscribed workspaces

### ✅ Billing Endpoints
- `/api/billing/checkout`: Validates price IDs against STRIPE_PLAN_MAP
- `/api/billing/status`: Returns plan info from PLAN_MATRIX via plan resolution
- `/api/billing/usage`: Calculates usage against PLAN_MATRIX limits

### ✅ Webhook Processing
- Located: `apps/web/src/lib/billing/stripeHandlers.ts`
- Processes subscription events and updates workspace plans
- Uses STRIPE_PLAN_MAP to resolve plan names from price IDs

### ✅ Tests Pass
- **Plan resolution tests**: ✅ `test/billing/resolveWorkspacePlan.test.ts` (6/6 pass)
- **Stripe webhook tests**: ✅ `test/api/webhooks.stripe.test.ts` (7/7 pass)
- **Plan gating tests**: Use consistent plan names across upload/publish/schedule scenarios

## Test Mode Configuration

For local development and testing, the codebase uses:

- **Test price IDs**: `price_1SPAJQJ2vBRZZMLQFeAuYJK5` (basic), `price_1SPALSJ2vBRZZMLQjM9eLBkf` (pro), `price_1SPAM7J2vBRZZMLQQaPkyiEW` (premium)
- **Mock price IDs in tests**: `price_basic`, `price_pro`, `price_premium`
- **Consistent plan names**: `basic`, `pro`, `premium` across all code

## Notes / Open Items

### ✅ No Issues Found
- All plan names are consistently used across the codebase
- No orphaned or unused plan definitions
- No mismatched Stripe mappings
- Tests align with implementation

### Potential Future Considerations
- **Trial periods**: Currently 7 days for basic/pro, 14 days for premium
- **Plan limits**: Usage tracking includes monthly quotas for clips, posts, etc.
- **Downgrade behavior**: Grace period for all plans
- **Upgrade behavior**: Immediate for basic/pro, prorated for premium

## Verification Commands

To verify alignment remains intact:

```bash
# Test plan resolution logic
pnpm test test/billing/resolveWorkspacePlan.test.ts

# Test Stripe webhook handling
pnpm test test/api/webhooks.stripe.test.ts

# Test plan gating across features
pnpm test test/api/plan-gating.upload.test.ts
pnpm test test/api/plan-gating.publish.test.ts
pnpm test test/api/plan-gating.schedule.test.ts
```

## Conclusion

The Cliply backend billing system is well-structured with clean separation between plan definitions (PLAN_MATRIX), Stripe mappings (STRIPE_PLAN_MAP), and resolution logic. All components reference the same set of plan names consistently, and tests validate this alignment.

**Ready for Epic 4 implementation** - the foundation is solid for onboarding flows that depend on these plan definitions.