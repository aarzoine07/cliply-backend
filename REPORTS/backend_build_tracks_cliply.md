# Cliply Backend Build Tracks

**Timestamp:** 2025-01-XX  
**Branch:** `backend-readiness-v1`  
**Purpose:** Coherent build plan organizing all delta items from Layer B into actionable tracks with phases, dependencies, and Person 1 priority guidance.

**Owner:** Backend Build Track Architect  
**Layer:** C (Planning & Track Design)

---

## Executive Summary

This document organizes **23 delta items** from `backend_delta_to_done_cliply.md` into **6 build tracks** that address the critical gaps preventing Cliply from being production-ready for real customers.

**Track Overview:**
- **T1 — YouTube Publishing & OAuth Completion**: Complete YouTube publishing functionality (3 deltas, 1 blocker)
- **T2 — RLS & Access Model Hardening**: Verify and fix workspace member access patterns (6 deltas, 1 high)
- **T3 — Posting Guard & Scheduling Reliability**: Align rate limits with plan matrix and verify cron deployment (3 deltas, 2 high)
- **T4 — Clip Classification & Tagging**: Implement clip classification feature (3 deltas, all medium)
- **T5 — Deployment, Ops & Production Hardening**: Document deployment and verify production configs (6 deltas, mix)
- **T6 — Licensing & Dependency Risk**: License file and dependency audit (3 deltas, all low)

**Capability Coverage:**
- **Capability D** (Multi-account Posting): T1
- **Capability H** (Security, Auth, RLS): T2
- **Capability E** (Scheduling & Anti-spam): T3
- **Capability B** (Long-form Ingestion → Clips): T4
- **Capabilities J, I, F** (Ops, Observability, Billing): T5
- **Capability K** (Licensing): T6
- **Capabilities A, C** (Multi-tenant, Clip Management): T2 (RLS verification)

**Risk Picture:**
- **2 Blocker deltas** (D-01, D-02) both in T1 — YouTube publishing is non-functional
- **6 High-severity deltas** distributed across T1, T2, T3, T5
- **7 Medium-severity deltas** across T2, T4, T5
- **5 Low-severity deltas** in T2, T5, T6

**Person 1 Readiness:**
- **T1**: Partially blocked — D-02 (OAuth callback) requires Person 2 verification
- **T2**: Partially blocked — H-01, C-01, E-04 require Person 2 RLS verification
- **T3**: Ready — All Person 1 owned
- **T4**: Ready — All Person 1 owned (may need product decision)
- **T5**: Ready — Mix of Person 1/2, Person 1 items can proceed
- **T6**: Ready — All Person 1 owned

---

## 1. Track Overview

| Track ID | Track Name | Owner (P1/P2/Shared) | Capabilities (A–K) | Delta IDs (sample) | Severity Mix | Key Dependencies | Ready-to-Start (P1)? |
|----------|------------|----------------------|---------------------|--------------------|--------------|------------------|----------------------|
| **T1** | YouTube Publishing & OAuth Completion | P1/P2/Shared | D | D-01, D-02, D-04 | 2 Blocker, 1 High | Google OAuth callback verification (D-02) | **Partial** — D-01 can start, D-02 needs Person 2 verification |
| **T2** | RLS & Access Model Hardening | P1/P2/Shared | H, C, E, A | H-01, C-01, E-04, H-02 | 1 High, 3 Medium, 2 Low | Person 2 RLS verification (H-01, C-01, E-04) | **Partial** — H-02, H-03 can start, core RLS work needs Person 2 |
| **T3** | Posting Guard & Scheduling Reliability | P1 | E | E-01, E-02, E-03 | 2 High, 1 Medium | Plan matrix stability (E-01) | **Yes** — Fully unblocked on backend-readiness-v1 |
| **T4** | Clip Classification & Tagging | P1 | B | B-01, B-02, B-03 | 3 Medium | Product decision: Is classification required for v1? | **Yes** — Fully unblocked, but needs product decision |
| **T5** | Deployment, Ops & Production Hardening | P1/P2 | J, I, F | J-01, J-02, I-01, F-01 | 2 High, 4 Medium | Production access for verification | **Yes** — Person 1 items can proceed independently |
| **T6** | Licensing & Dependency Risk | P1 | K | K-01, K-02, K-03 | 3 Low | None | **Yes** — Fully unblocked, low priority |

---

## 2. Track Charters

### 2.T1 Track — YouTube Publishing & OAuth Completion

#### 2.T1.1 Goal & Outcome

When this track is complete:
- **YouTube publishing is fully functional** — Real API integration replaces stubbed client
- **Google OAuth flow is complete** — Users can connect YouTube accounts end-to-end
- **E2E tests exist** — Full pipeline test covers YouTube publishing
- **Production-ready** — YouTube publishing works for real customers

**Product View:**
- Creators can publish clips to YouTube Shorts via real API
- OAuth flow allows connecting multiple YouTube accounts per workspace
- Posting guard prevents spam on YouTube platform
- Error handling provides clear feedback for API failures

#### 2.T1.2 Scope & Capabilities

**Capabilities covered:** D (Multi-account Posting Engine)

**In-scope:**
- **D-01** (Blocker, Code, P1): Implement real YouTube API client — Replace stubbed `uploadShort()` method with real YouTube Data API v3 integration
- **D-02** (Blocker, Code, P2): Verify Google OAuth callback flow — Ensure callback endpoint exists and handles token exchange correctly
- **D-04** (High, Test, Shared): Add E2E test for YouTube publishing — Full pipeline test: long video → clips → scheduled → posted to YouTube

**Out-of-scope:**
- TikTok publishing (already complete)
- Posting guard plan alignment (T3)
- RLS verification (T2)
- Account validation (already implemented via `getConnectedAccountsForPublish`)

#### 2.T1.3 Dependencies & Blocking

**Internal dependencies:**
- **E-01** (Posting guard plan alignment): Should be done first or in parallel to ensure YouTube posting respects plan limits
- **D-02** blocks **D-01** testing: Cannot fully test YouTube API client without working OAuth flow

**External dependencies:**
- **Google Cloud Console**: OAuth app must be configured with correct redirect URLs
- **YouTube Data API v3**: API credentials must be available (OAuth client ID/secret)
- **Person 2 verification**: D-02 requires Person 2 to verify callback endpoint exists and works

**Blocking analysis:**
- **D-01 can start**: YouTube API client implementation can proceed independently (using test tokens if needed)
- **D-02 blocks completion**: Full E2E testing requires OAuth flow to be complete
- **D-04 blocks completion**: E2E test requires both D-01 and D-02 to be done

#### 2.T1.4 Definition of Done (DoD)

**Code & Logic:**
- YouTube API client (`apps/worker/src/services/youtube/client.ts`) calls real YouTube Data API v3 `videos.insert` endpoint
- No stubbed methods remain — `uploadShort()` returns real video IDs
- Error handling covers API rate limits, quota exceeded, invalid tokens, network failures
- Token refresh logic works (if applicable)
- `(Cursor-friendly code/test change)`

**Tests:**
- Unit tests for YouTube client cover success and error paths
- Integration test with YouTube API (may use test account or mocks)
- E2E test (`test/engine/full-pipeline-youtube.e2e.test.ts`) covers: URL → download → transcribe → highlight → render → publish to YouTube
- `test:core` remains green
- `(Cursor-friendly code/test change)`

**Security & RLS:**
- OAuth tokens are encrypted at rest (if not already)
- Account validation ensures YouTube accounts belong to workspace before publishing
- `(Cursor-friendly code/test change)`

**Observability:**
- Structured logs for YouTube API calls (request/response, duration, errors)
- Sentry captures YouTube API failures with context (account ID, clip ID, error type)
- Metrics for YouTube posting volume and success rate
- `(Cursor-friendly code/test change)`

**Ops & Docs:**
- `backend_ops_runbook.md` updated with YouTube posting troubleshooting section
- Error codes documented for common YouTube API failures
- `(Joint: code + manual)`

#### 2.T1.5 Risk & Failure Modes

**Risk: Posting to wrong account**
- **Mitigation**: Account validation in `getConnectedAccountsForPublish` (already implemented)
- **Delta**: D-03 (already implemented, not in this track)

**Risk: Silent failures in YouTube API**
- **Mitigation**: Comprehensive error handling and logging (DoD: Observability)
- **Delta**: D-01

**Risk: OAuth flow incomplete**
- **Mitigation**: D-02 verification ensures callback endpoint works
- **Delta**: D-02

**Risk: Rate limit violations**
- **Mitigation**: Posting guard (E-01 in T3) and YouTube API quota management
- **Delta**: E-01 (T3), D-01

#### 2.T1.6 Suggested Implementation Flow (Phases)

**Phase 1 — YouTube API Client Foundation**
- **Delta IDs**: D-01 (partial)
- **Work**: Implement YouTube Data API v3 client with real API calls, error handling, logging
- **Tests**: Unit tests for client (may use mocks for API calls)
- **Safe to ship?** No — Still stubbed in production until Phase 2
- **Tests must pass**: `test:core`, YouTube client unit tests

**Phase 2 — OAuth Verification & Integration**
- **Delta IDs**: D-02
- **Work**: Person 2 verifies Google OAuth callback endpoint, fixes if needed
- **Tests**: OAuth flow integration test
- **Safe to ship?** No — YouTube client still needs full E2E validation
- **Tests must pass**: OAuth integration tests

**Phase 3 — E2E Testing & Production Readiness**
- **Delta IDs**: D-01 (complete), D-04
- **Work**: Complete YouTube client implementation, add E2E test, update runbook
- **Tests**: Full E2E test for YouTube publishing pipeline
- **Safe to ship?** Yes — After E2E test passes and runbook updated
- **Tests must pass**: `test:core`, E2E YouTube publishing test

---

### 2.T2 Track — RLS & Access Model Hardening

#### 2.T2.1 Goal & Outcome

When this track is complete:
- **Workspace members can access workspace resources** — Not just owners
- **RLS policies are verified and tested** — All content tables (projects, clips, schedules) allow workspace member access
- **RLS integration tests exist** — Automated tests verify RLS policies work correctly
- **Production RLS is verified** — All policies are enabled in production Supabase

**Product View:**
- Workspace members (not just owners) can view and manage clips, projects, schedules
- Multi-user workspaces function correctly
- No cross-workspace data leakage
- Clear error messages for unauthorized access

#### 2.T2.2 Scope & Capabilities

**Capabilities covered:** H (Security, Auth, RLS), C (Clip Management), E (Scheduling), A (Multi-tenant)

**In-scope:**
- **H-01** (High, RLS, P2): Verify projects/clips/schedules RLS allows workspace member access — Review and update policies if needed
- **C-01** (Medium, RLS, P2): Verify clips RLS allows workspace member access — Same as H-01 but clips-specific
- **E-04** (Medium, RLS, P2): Verify schedules RLS allows workspace member access — Same as H-01 but schedules-specific
- **H-02** (Medium, Test, P1): Add RLS integration tests — Test workspace member access patterns
- **H-03** (Medium, Ops, P1): Verify RLS policies enabled in production — Manual Supabase dashboard check
- **A-01** (Low, RLS, P2): Verify connected_accounts dual access pattern — Document intentional pattern

**Out-of-scope:**
- Jobs RLS (already stabilized)
- Workspace/workspace_members RLS (already correct)
- Service-role patterns (already correct)

#### 2.T2.3 Dependencies & Blocking

**Internal dependencies:**
- **H-01, C-01, E-04** are related — All three check the same pattern (owner_id vs workspace_member)
- **H-02** depends on **H-01** — Tests need policies to be correct first

**External dependencies:**
- **Supabase production access**: H-03 requires dashboard access
- **Person 2 RLS work**: H-01, C-01, E-04, A-01 require Person 2 to verify/update policies

**Blocking analysis:**
- **H-02, H-03 can start**: Person 1 can write tests and verify production independently
- **H-01, C-01, E-04 block completion**: Core RLS verification requires Person 2
- **A-01 is independent**: Can be done in parallel

#### 2.T2.4 Definition of Done (DoD)

**Code & Logic:**
- RLS policies for projects, clips, schedules use `is_workspace_member()` helper (if verification shows owner_id pattern is insufficient)
- Policies allow workspace members to SELECT/UPDATE/DELETE (as appropriate)
- No breaking changes to existing owner-based access
- `(Cursor-friendly code/test change)` (if policies need updates)

**Tests:**
- RLS integration tests (`test/rls/projects-clips-schedules.rls.test.ts`) verify:
  - Workspace members can access their workspace's resources
  - Workspace members cannot access other workspaces' resources
  - Owners retain full access
- Tests use real Supabase client with authenticated users
- `test:core` remains green
- `(Cursor-friendly code/test change)`

**Security & RLS:**
- All RLS policies are enabled in production (verified via Supabase dashboard)
- Policies are documented in migration files with comments
- `(Manual ops / dashboard work)` (H-03)

**Observability:**
- RLS violations are logged (if applicable)
- `(Cursor-friendly code/test change)` (if logging needed)

**Ops & Docs:**
- `REPORTS/rls_posture_backend-readiness-v1.md` updated with verification results
- `backend_ops_runbook.md` updated with RLS troubleshooting for content tables
- `(Joint: code + manual)`

#### 2.T2.5 Risk & Failure Modes

**Risk: Workspace members cannot access clips/projects/schedules**
- **Mitigation**: H-01, C-01, E-04 verification and policy updates
- **Delta**: H-01, C-01, E-04

**Risk: Cross-workspace data leakage**
- **Mitigation**: RLS policies correctly scoped, integration tests verify isolation
- **Delta**: H-01, H-02

**Risk: RLS policies not applied in production**
- **Mitigation**: H-03 verification ensures policies are enabled
- **Delta**: H-03

**Risk: Breaking existing owner access**
- **Mitigation**: Policies maintain owner access while adding member access
- **Delta**: H-01, C-01, E-04

#### 2.T2.6 Suggested Implementation Flow (Phases)

**Phase 1 — RLS Policy Verification (Person 2)**
- **Delta IDs**: H-01, C-01, E-04, A-01
- **Work**: Person 2 reviews RLS policies, updates if needed to allow workspace member access
- **Tests**: Manual verification in test environment
- **Safe to ship?** No — Needs integration tests
- **Tests must pass**: Manual RLS checks

**Phase 2 — RLS Integration Tests (Person 1)**
- **Delta IDs**: H-02
- **Work**: Write RLS integration tests for projects/clips/schedules
- **Tests**: Automated RLS tests
- **Safe to ship?** No — Production verification needed
- **Tests must pass**: `test:core`, new RLS integration tests

**Phase 3 — Production Verification & Documentation**
- **Delta IDs**: H-03
- **Work**: Verify RLS policies enabled in production, update docs
- **Tests**: Production dashboard check
- **Safe to ship?** Yes — After production verification and docs updated
- **Tests must pass**: Production RLS policy verification

---

### 2.T3 Track — Posting Guard & Scheduling Reliability

#### 2.T3.1 Goal & Outcome

When this track is complete:
- **Posting guard limits align with plan matrix** — Rate limits match plan tiers (basic/pro/premium)
- **Schedule scanning cron is deployed and running** — Scheduled posts execute automatically
- **Production-ready scheduling** — Users can schedule posts and they execute reliably

**Product View:**
- Posting guard enforces plan-based limits (e.g., basic: 10/day, pro: 30/day, premium: 50/day)
- Scheduled posts execute on time via cron job
- Clear error messages when posting limits are exceeded
- Cron failures are logged and recoverable

#### 2.T3.2 Scope & Capabilities

**Capabilities covered:** E (Scheduling & Anti-spam)

**In-scope:**
- **E-01** (High, Code, P1): Align posting guard limits with plan matrix — Replace hardcoded limits with plan-based lookup
- **E-02** (High, Ops, P1): Verify schedule scanning cron is deployed and running — Check Vercel cron or external cron service
- **E-03** (Medium, Env, P1): CRON_SECRET env key exists — Already implemented, verification only

**Out-of-scope:**
- RLS verification for schedules (T2)
- Schedule creation APIs (already implemented)
- Posting guard implementation (already exists, just needs plan alignment)

#### 2.T3.3 Dependencies & Blocking

**Internal dependencies:**
- **F (Billing) plan matrix**: E-01 depends on plan matrix being stable (already is)
- **E-02** is independent — Can be verified separately

**External dependencies:**
- **Vercel cron or external cron service**: E-02 requires deployment verification
- **Production access**: E-02 requires access to verify cron is running

**Blocking analysis:**
- **E-01 can start**: Plan matrix is stable, posting guard can be updated
- **E-02 blocks completion**: Cron must be deployed for scheduling to work
- **E-03 is already done**: Just needs verification

#### 2.T3.4 Definition of Done (DoD)

**Code & Logic:**
- `postingGuard.ts` reads limits from `planMatrix.ts` instead of hardcoded values
- TODO comment removed
- Plan-based limits are correctly applied (basic/pro/premium)
- `(Cursor-friendly code/test change)`

**Tests:**
- Unit tests verify posting guard uses plan matrix limits
- Integration tests verify plan-based rate limiting works
- `test:core` remains green
- `(Cursor-friendly code/test change)`

**Security & RLS:**
- No security changes
- `(N/A)`

**Observability:**
- Posting guard violations log plan tier and limit details
- Cron scan failures are logged with context
- `(Cursor-friendly code/test change)`

**Ops & Docs:**
- `backend_ops_runbook.md` updated with posting guard troubleshooting
- Cron deployment process documented (if not already)
- `(Joint: code + manual)`

#### 2.T3.5 Risk & Failure Modes

**Risk: Posting limits don't match plan tiers**
- **Mitigation**: E-01 aligns limits with plan matrix
- **Delta**: E-01

**Risk: Scheduled posts never execute**
- **Mitigation**: E-02 verification ensures cron is deployed
- **Delta**: E-02

**Risk: Cron failures are silent**
- **Mitigation**: Observability logging (DoD)
- **Delta**: E-02 (verification)

#### 2.T3.6 Suggested Implementation Flow (Phases)

**Phase 1 — Posting Guard Plan Alignment**
- **Delta IDs**: E-01
- **Work**: Update `postingGuard.ts` to use plan matrix, remove TODO, add tests
- **Tests**: Unit and integration tests for plan-based limits
- **Safe to ship?** Yes — After tests pass
- **Tests must pass**: `test:core`, posting guard tests

**Phase 2 — Cron Deployment Verification**
- **Delta IDs**: E-02, E-03
- **Work**: Verify cron is deployed (Vercel or external), verify CRON_SECRET is set
- **Tests**: Manual verification, test cron endpoint with secret
- **Safe to ship?** Yes — After verification
- **Tests must pass**: Cron endpoint test with authentication

**Phase 3 — Documentation & Observability**
- **Delta IDs**: (Documentation)
- **Work**: Update runbook with posting guard and cron troubleshooting
- **Tests**: Documentation review
- **Safe to ship?** Yes — Documentation complete
- **Tests must pass**: N/A

---

### 2.T4 Track — Clip Classification & Tagging

#### 2.T4.1 Goal & Outcome

When this track is complete:
- **Clips can be classified/tagged** — Users can tag clips with emotions/categories (exciting, sad, happy, etc.)
- **Classification is stored and queryable** — Database schema supports classification
- **Classification is tested** — Unit and integration tests exist

**Product View:**
- Creators can tag clips with emotions/categories during approval or after
- Clips can be filtered/searched by classification
- Classification helps organize clip library

**Note:** This track requires product decision: Is classification required for v1?

#### 2.T4.2 Scope & Capabilities

**Capabilities covered:** B (Long-form Ingestion → Clips Pipeline)

**In-scope:**
- **B-01** (Medium, Code, P1): Implement clip classification/tagging — Add classification logic and APIs
- **B-02** (Medium, Schema, P1): Add classification/tagging columns to clips table — Migration for classification fields
- **B-03** (Medium, Test, P1): Add tests for clip classification — Unit and integration tests

**Out-of-scope:**
- Clip pipeline (already complete)
- Clip approval/rejection (already complete)
- Classification UI (frontend work)

#### 2.T4.3 Dependencies & Blocking

**Internal dependencies:**
- **B-02** must be done before **B-01** — Schema must exist before code uses it
- **B-03** depends on **B-01** — Tests need implementation

**External dependencies:**
- **Product decision**: Is classification required for v1? If not, this track can be deferred
- **No Person 2 dependencies**

**Blocking analysis:**
- **Track can start**: All Person 1 owned, no external blockers
- **Product decision blocks start**: Need confirmation classification is required

#### 2.T4.4 Definition of Done (DoD)

**Code & Logic:**
- Classification/tagging API endpoints exist (e.g., `POST /api/clips/[id]/classify`)
- Classification is stored in clips table
- Classification can be queried/filtered
- `(Cursor-friendly code/test change)`

**Tests:**
- Unit tests for classification logic
- Integration tests for classification APIs
- Tests verify classification is workspace-scoped
- `test:core` remains green
- `(Cursor-friendly code/test change)`

**Security & RLS:**
- Classification respects workspace boundaries (RLS)
- `(Cursor-friendly code/test change)`

**Observability:**
- Classification operations are logged
- `(Cursor-friendly code/test change)`

**Ops & Docs:**
- Migration documented
- API endpoints documented (if not auto-generated)
- `(Joint: code + manual)`

#### 2.T4.5 Risk & Failure Modes

**Risk: Classification not needed for v1**
- **Mitigation**: Product decision required before starting
- **Delta**: B-01, B-02, B-03 (all deferred if not needed)

**Risk: Schema changes break existing clips**
- **Mitigation**: Migration adds nullable columns, existing clips unaffected
- **Delta**: B-02

#### 2.T4.6 Suggested Implementation Flow (Phases)

**Phase 1 — Schema & Migration**
- **Delta IDs**: B-02
- **Work**: Create migration to add classification columns to clips table
- **Tests**: Migration test, verify existing clips unaffected
- **Safe to ship?** Yes — Schema change is additive
- **Tests must pass**: Migration test

**Phase 2 — Classification Implementation**
- **Delta IDs**: B-01
- **Work**: Implement classification APIs and logic
- **Tests**: Unit and integration tests
- **Safe to ship?** Yes — After tests pass
- **Tests must pass**: `test:core`, classification tests

**Phase 3 — Testing & Documentation**
- **Delta IDs**: B-03
- **Work**: Add comprehensive tests, update docs
- **Tests**: Full test coverage
- **Safe to ship?** Yes — After tests and docs complete
- **Tests must pass**: All classification tests

---

### 2.T5 Track — Deployment, Ops & Production Hardening

#### 2.T5.1 Goal & Outcome

When this track is complete:
- **Deployment process is documented** — Migration application and worker deployment are clear
- **Production configs are verified** — Stripe, Sentry, cron are configured correctly
- **Deployment pipeline is complete** — Worker and API are deployed reliably

**Product View:**
- Developers can deploy backend confidently
- Production environment is correctly configured
- Errors are captured in Sentry
- Billing works correctly

#### 2.T5.2 Scope & Capabilities

**Capabilities covered:** J (Operations, CI/CD, Deployments), I (Observability & Logging), F (Usage & Billing)

**In-scope:**
- **J-01** (Medium, Doc, P1): Document migration application process — How to apply migrations in production
- **J-02** (Medium, Ops, P1): Verify deployment pipeline completeness — Worker and API deployment verified
- **J-03** (Low, Test, P1): Add migration rollback tests — Test migration rollback works
- **I-01** (Medium, Config, P1): Verify Sentry configuration — Sentry DSN set in production
- **F-01** (High, Config, P2): Verify Stripe products/prices match code — Manual Stripe dashboard check
- **F-02** (High, Config, P2): Verify Stripe webhook endpoint configuration — Manual Stripe dashboard check

**Out-of-scope:**
- CI pipeline (already exists)
- Environment validation (already exists)
- Billing code (already implemented)

#### 2.T5.3 Dependencies & Blocking

**Internal dependencies:**
- **J-01** and **J-02** are related — Both document deployment process
- **F-01** and **F-02** are related — Both verify Stripe config

**External dependencies:**
- **Production access**: All items require production access for verification
- **Stripe dashboard access**: F-01, F-02 require Stripe access
- **Sentry project**: I-01 requires Sentry project setup

**Blocking analysis:**
- **J-01, J-02, J-03 can start**: Person 1 can document and verify independently
- **I-01 can start**: Person 1 can verify Sentry config
- **F-01, F-02 require Person 2**: Stripe config verification

#### 2.T5.4 Definition of Done (DoD)

**Code & Logic:**
- Migration rollback tests exist (J-03)
- `(Cursor-friendly code/test change)`

**Tests:**
- Migration rollback test verifies rollback works correctly
- `test:core` remains green
- `(Cursor-friendly code/test change)`

**Security & RLS:**
- No security changes
- `(N/A)`

**Observability:**
- Sentry is configured and capturing errors (I-01)
- `(Manual ops / dashboard work)`

**Ops & Docs:**
- Migration application process documented (J-01)
- Deployment pipeline documented (J-02)
- Stripe config verified and documented (F-01, F-02)
- `backend_ops_runbook.md` updated with deployment procedures
- `(Joint: code + manual)`

#### 2.T5.5 Risk & Failure Modes

**Risk: Migrations applied incorrectly in production**
- **Mitigation**: J-01 documents correct process
- **Delta**: J-01

**Risk: Worker not deployed**
- **Mitigation**: J-02 verification ensures worker is deployed
- **Delta**: J-02

**Risk: Stripe billing fails**
- **Mitigation**: F-01, F-02 verification ensures Stripe is configured
- **Delta**: F-01, F-02

**Risk: Errors not captured**
- **Mitigation**: I-01 verification ensures Sentry is configured
- **Delta**: I-01

#### 2.T5.6 Suggested Implementation Flow (Phases)

**Phase 1 — Documentation (Person 1)**
- **Delta IDs**: J-01, J-02
- **Work**: Document migration and deployment processes
- **Tests**: Documentation review
- **Safe to ship?** Yes — Documentation only
- **Tests must pass**: N/A

**Phase 2 — Production Verification (Person 1)**
- **Delta IDs**: I-01, J-02 (verification)
- **Work**: Verify Sentry config, verify deployment pipeline
- **Tests**: Production checks
- **Safe to ship?** Yes — Verification only
- **Tests must pass**: Production verification

**Phase 3 — Stripe Verification (Person 2)**
- **Delta IDs**: F-01, F-02
- **Work**: Verify Stripe products/prices and webhook endpoint
- **Tests**: Stripe dashboard checks
- **Safe to ship?** Yes — Verification only
- **Tests must pass**: Stripe config verification

**Phase 4 — Migration Rollback Tests (Person 1)**
- **Delta IDs**: J-03
- **Work**: Add migration rollback tests
- **Tests**: Rollback test
- **Safe to ship?** Yes — Tests only
- **Tests must pass**: `test:core`, migration rollback test

---

### 2.T6 Track — Licensing & Dependency Risk

#### 2.T6.1 Goal & Outcome

When this track is complete:
- **LICENSE file exists** — Repository has appropriate license
- **Dependencies are audited** — Security vulnerabilities and license compatibility documented
- **License compliance verified** — No problematic licenses (e.g., AGPL)

**Product View:**
- Legal compliance for dependencies
- Security vulnerabilities tracked
- License clarity for contributors

#### 2.T6.2 Scope & Capabilities

**Capabilities covered:** K (Licensing & Dependency Risk)

**In-scope:**
- **K-01** (Low, License, P1): Add LICENSE file to repository root — Create LICENSE file
- **K-02** (Low, License, P1): Run dependency audit — `pnpm audit` and document findings
- **K-03** (Low, License, P1): Review dependency licenses — Check for AGPL and other problematic licenses

**Out-of-scope:**
- Code changes (license only)
- Dependency updates (audit only, not fixes)

#### 2.T6.3 Dependencies & Blocking

**Internal dependencies:**
- None

**External dependencies:**
- None

**Blocking analysis:**
- **Track can start**: No dependencies, low priority
- **Can be done anytime**: Not blocking other work

#### 2.T6.4 Definition of Done (DoD)

**Code & Logic:**
- LICENSE file exists at repository root
- `(Manual ops / dashboard work)`

**Tests:**
- No tests required
- `(N/A)`

**Security & RLS:**
- No security changes
- `(N/A)`

**Observability:**
- Dependency audit results documented
- `(Manual ops / dashboard work)`

**Ops & Docs:**
- LICENSE file added
- Dependency audit documented (security vulnerabilities, license compatibility)
- `(Manual ops / dashboard work)`

#### 2.T6.5 Risk & Failure Modes

**Risk: License violations**
- **Mitigation**: K-03 reviews all dependencies
- **Delta**: K-03

**Risk: Security vulnerabilities**
- **Mitigation**: K-02 audits dependencies
- **Delta**: K-02

#### 2.T6.6 Suggested Implementation Flow (Phases)

**Phase 1 — License File**
- **Delta IDs**: K-01
- **Work**: Add LICENSE file to repository root
- **Tests**: N/A
- **Safe to ship?** Yes — License file only
- **Tests must pass**: N/A

**Phase 2 — Dependency Audit**
- **Delta IDs**: K-02, K-03
- **Work**: Run `pnpm audit`, review licenses, document findings
- **Tests**: N/A
- **Safe to ship?** Yes — Audit only
- **Tests must pass**: N/A

---

## 3. Delta-to-Track Mapping

| Delta ID | Capability (A–K) | Short Description | Severity (Blocker/High/Med/Low) | Owner (P1/P2/Shared) | Category (Code/RLS/Ops/Config/Docs) | Track ID | Phase (Tn.PhaseX) | Ready Now (on backend-readiness-v1)? | Notes |
|----------|------------------|-------------------|----------------------------------|----------------------|-------------------------------------|----------|-------------------|--------------------------------------|-------|
| A-01 | A | Verify connected_accounts dual access pattern | Low | P2 | RLS | T2 | T2.Phase1 | **No** — Requires Person 2 RLS verification | Related to H-01 |
| B-01 | B | Implement clip classification/tagging | Medium | P1 | Code | T4 | T4.Phase2 | **Yes** — But needs product decision | Defer if not required for v1 |
| B-02 | B | Add classification columns to clips table | Medium | P1 | Schema | T4 | T4.Phase1 | **Yes** — But needs product decision | Defer if not required for v1 |
| B-03 | B | Add tests for clip classification | Medium | P1 | Test | T4 | T4.Phase3 | **Yes** — But needs product decision | Defer if not required for v1 |
| C-01 | C | Verify clips RLS allows workspace member access | Medium | P2 | RLS | T2 | T2.Phase1 | **No** — Requires Person 2 RLS verification | Related to H-01 |
| D-01 | D | Implement real YouTube API client | Blocker | P1 | Code | T1 | T1.Phase1 | **Yes** — Can start independently | Blocks YouTube publishing |
| D-02 | D | Verify Google OAuth callback flow | Blocker | P2 | Code | T1 | T1.Phase2 | **No** — Requires Person 2 verification | Blocks D-01 testing |
| D-03 | D | Account validation in publish endpoints | Low | P2 | Code | (Already implemented) | N/A | N/A | Already implemented, not a delta | |
| D-04 | D | Add E2E test for YouTube publishing | High | Shared | Test | T1 | T1.Phase3 | **No** — Requires D-01 and D-02 | Blocks completion |
| E-01 | E | Align posting guard limits with plan matrix | High | P1 | Code | T3 | T3.Phase1 | **Yes** — Fully unblocked | Plan matrix is stable |
| E-02 | E | Verify schedule scanning cron deployment | High | P1 | Ops | T3 | T3.Phase2 | **Yes** — Requires production access | Manual verification |
| E-03 | E | CRON_SECRET env key exists | Medium | P1 | Env | T3 | T3.Phase2 | **Yes** — Already implemented | Verification only |
| E-04 | E | Verify schedules RLS allows workspace member access | Medium | P2 | RLS | T2 | T2.Phase1 | **No** — Requires Person 2 RLS verification | Related to H-01 |
| F-01 | F | Verify Stripe products/prices match code | High | P2 | Config | T5 | T5.Phase3 | **No** — Requires Person 2 and Stripe access | Manual verification |
| F-02 | F | Verify Stripe webhook endpoint configuration | High | P2 | Config | T5 | T5.Phase3 | **No** — Requires Person 2 and Stripe access | Manual verification |
| H-01 | H | Verify projects/clips/schedules RLS allows workspace member access | High | P2 | RLS | T2 | T2.Phase1 | **No** — Requires Person 2 RLS verification | Core RLS work |
| H-02 | H | Add RLS integration tests | Medium | P1 | Test | T2 | T2.Phase2 | **Yes** — Can start after H-01 | Depends on H-01 |
| H-03 | H | Verify RLS policies enabled in production | Medium | P1 | Ops | T2 | T2.Phase3 | **Yes** — Requires production access | Manual verification |
| I-01 | I | Verify Sentry configuration | Medium | P1 | Config | T5 | T5.Phase2 | **Yes** — Requires production access | Manual verification |
| J-01 | J | Document migration application process | Medium | P1 | Doc | T5 | T5.Phase1 | **Yes** — Fully unblocked | Documentation only |
| J-02 | J | Verify deployment pipeline completeness | Medium | P1 | Ops | T5 | T5.Phase1, T5.Phase2 | **Yes** — Requires production access | Manual verification |
| J-03 | J | Add migration rollback tests | Low | P1 | Test | T5 | T5.Phase4 | **Yes** — Fully unblocked | Tests only |
| K-01 | K | Add LICENSE file to repository root | Low | P1 | License | T6 | T6.Phase1 | **Yes** — Fully unblocked | Low priority |
| K-02 | K | Run dependency audit | Low | P1 | License | T6 | T6.Phase2 | **Yes** — Fully unblocked | Low priority |
| K-03 | K | Review dependency licenses | Low | P1 | License | T6 | T6.Phase2 | **Yes** — Fully unblocked | Low priority |

**Summary:**
- **23 delta items** mapped to 6 tracks
- **9 deltas** require Person 2 (blocked on Person 2 work)
- **14 deltas** can be done by Person 1 independently
- **2 blocker deltas** both in T1 (YouTube publishing)

---

## 4. Person 1 (Ariel) Priority Plan

### 4.1 Principles

**Constraints:**
- Work on `backend-readiness-v1` branch only — Do not touch main
- David (Person 2) is working on engine surface integration in a separate branch
- Keep `test:core` and env checks green at all times
- No breaking changes to existing functionality
- Production access required for some verification tasks

**Goals:**
- Close blocker and high-severity deltas first
- Maximize independent progress (Person 1 owned items)
- Minimize dependencies on Person 2 work
- Keep tests stable and ops safe

### 4.2 Recommended Order of Work

**1. Track T3 — Phase 1 (Posting Guard Plan Alignment)**
- **Why**: High severity, fully unblocked, no Person 2 dependencies
- **Deltas closed**: E-01
- **Pre-work**: Review `packages/shared/src/billing/planMatrix.ts` and `packages/shared/src/engine/postingGuard.ts`
- **Risk**: Low — Code change only, well-tested area
- **Time estimate**: 1-2 days

**2. Track T1 — Phase 1 (YouTube API Client Foundation)**
- **Why**: Blocker severity, can start independently (D-01)
- **Deltas closed**: D-01 (partial)
- **Pre-work**: Review YouTube Data API v3 documentation, check existing TikTok client for patterns
- **Risk**: Medium — External API integration, needs careful error handling
- **Time estimate**: 3-5 days
- **Note**: Cannot complete E2E testing until D-02 is verified (Person 2)

**3. Track T5 — Phase 1 (Deployment Documentation)**
- **Why**: Medium severity, documentation only, no code changes
- **Deltas closed**: J-01, J-02 (documentation)
- **Pre-work**: Review existing deployment process, check Vercel config, worker deployment
- **Risk**: Low — Documentation only
- **Time estimate**: 1 day

**4. Track T2 — Phase 2 (RLS Integration Tests)**
- **Why**: Medium severity, can start after Person 2 completes Phase 1
- **Deltas closed**: H-02
- **Pre-work**: Wait for Person 2 to complete H-01, C-01, E-04 (T2.Phase1)
- **Risk**: Low — Tests only, no production changes
- **Time estimate**: 2-3 days
- **Note**: Blocked on Person 2 RLS verification

**5. Track T3 — Phase 2 (Cron Deployment Verification)**
- **Why**: High severity, operational verification
- **Deltas closed**: E-02, E-03
- **Pre-work**: Check Vercel cron config or external cron service
- **Risk**: Low — Verification only
- **Time estimate**: 0.5 day
- **Note**: Requires production access

**6. Track T5 — Phase 2 (Production Verification)**
- **Why**: Medium severity, operational verification
- **Deltas closed**: I-01, J-02 (verification)
- **Pre-work**: Access to production Sentry and deployment configs
- **Risk**: Low — Verification only
- **Time estimate**: 0.5 day
- **Note**: Requires production access

**7. Track T5 — Phase 4 (Migration Rollback Tests)**
- **Why**: Low severity, tests only
- **Deltas closed**: J-03
- **Pre-work**: Review existing migration structure
- **Risk**: Low — Tests only
- **Time estimate**: 1 day

**8. Track T4 — Clip Classification (If Product Decision is "Yes")**
- **Why**: Medium severity, but requires product decision
- **Deltas closed**: B-01, B-02, B-03
- **Pre-work**: Confirm with product: Is classification required for v1?
- **Risk**: Medium — Schema changes, but additive
- **Time estimate**: 3-4 days
- **Note**: Defer if not required for v1

**9. Track T6 — Licensing (Low Priority)**
- **Why**: Low severity, not blocking
- **Deltas closed**: K-01, K-02, K-03
- **Pre-work**: None
- **Risk**: Low — Documentation and audit only
- **Time estimate**: 1 day
- **Note**: Can be done anytime, not urgent

### 4.3 Items to Defer Until After Integration

**Blocked on Person 2 Work:**
- **T1.Phase2** (D-02): Google OAuth callback verification — Requires Person 2
- **T1.Phase3** (D-04): E2E YouTube test — Requires D-01 and D-02 complete
- **T2.Phase1** (H-01, C-01, E-04, A-01): RLS policy verification — Requires Person 2
- **T5.Phase3** (F-01, F-02): Stripe config verification — Requires Person 2

**Post-MVP (Nice-to-Have):**
- **T4** (B-01, B-02, B-03): Clip classification — Defer if not required for v1
- **T6** (K-01, K-02, K-03): Licensing — Low priority, not blocking

**Summary:**
- **4 tracks** have Person 1 work that can proceed independently (T1.Phase1, T3, T5.Phase1/2/4, T4 if approved)
- **2 tracks** are fully blocked on Person 2 (T1.Phase2/3, T2.Phase1)
- **1 track** is low priority (T6)

---

## 5. Implementation Prompt Seeds (for future Cursor chats)

### 5.T1 — YouTube Publishing & OAuth Completion

**Context:**
Implement real YouTube Data API v3 integration to replace the stubbed client in `apps/worker/src/services/youtube/client.ts`. The current implementation returns fake video IDs (`dryrun_${uuid}`). This track also requires verifying the Google OAuth callback flow (Person 2) and adding E2E tests.

**Files & modules likely involved:**
- `apps/worker/src/services/youtube/client.ts` — YouTube API client (stubbed)
- `apps/worker/src/pipelines/publish-youtube.ts` — YouTube publishing pipeline
- `apps/web/src/pages/api/oauth/google/callback.ts` — OAuth callback (needs verification)
- `test/engine/full-pipeline-youtube.e2e.test.ts` — E2E test (to be created)
- `packages/shared/src/engine/postingGuard.ts` — Posting guard (already uses YouTube)

**Hard constraints:**
- No changes outside `apps/worker/src/services/youtube/`, `apps/worker/src/pipelines/publish-youtube.ts`, test files
- `test:core` must remain green
- Error handling must cover YouTube API rate limits, quota exceeded, invalid tokens
- OAuth tokens must be encrypted at rest (if not already)

**Success criteria:**
- YouTube API client calls real `videos.insert` endpoint
- No stubbed methods remain
- E2E test covers full pipeline: URL → download → transcribe → highlight → render → publish to YouTube
- `backend_ops_runbook.md` updated with YouTube posting troubleshooting

---

### 5.T2 — RLS & Access Model Hardening

**Context:**
Verify and update RLS policies for projects, clips, and schedules tables to ensure workspace members (not just owners) can access workspace resources. This requires Person 2 to verify/update policies, then Person 1 to add integration tests.

**Files & modules likely involved:**
- `supabase/migrations/20251020043717_remote_schema.sql` — RLS policies (lines 1076-1086, 1302-1312, 1343-1353)
- `test/rls/projects-clips-schedules.rls.test.ts` — RLS integration tests (to be created)
- `REPORTS/rls_posture_backend-readiness-v1.md` — RLS documentation (to be updated)

**Hard constraints:**
- No breaking changes to existing owner-based access
- Policies must use `is_workspace_member()` helper (if updates needed)
- `test:core` must remain green
- Production RLS policies must be verified (manual step)

**Success criteria:**
- RLS policies allow workspace members to access their workspace's resources
- Integration tests verify workspace isolation (members cannot access other workspaces)
- Production RLS policies verified and enabled
- `backend_ops_runbook.md` updated with RLS troubleshooting

---

### 5.T3 — Posting Guard & Scheduling Reliability

**Context:**
Align posting guard rate limits with plan matrix (basic/pro/premium) instead of hardcoded values. Verify schedule scanning cron is deployed and running in production.

**Files & modules likely involved:**
- `packages/shared/src/engine/postingGuard.ts` — Posting guard (line 102 has TODO)
- `packages/shared/src/billing/planMatrix.ts` — Plan matrix (already stable)
- `apps/web/src/pages/api/cron/scan-schedules.ts` — Cron endpoint (already exists)
- `test/engine/postingGuard.test.ts` — Posting guard tests (to be updated)

**Hard constraints:**
- No changes to plan matrix (it's stable)
- `test:core` must remain green
- Cron verification requires production access

**Success criteria:**
- Posting guard reads limits from plan matrix
- TODO comment removed
- Unit tests verify plan-based limits
- Cron deployment verified (Vercel or external)
- `backend_ops_runbook.md` updated with posting guard troubleshooting

---

### 5.T4 — Clip Classification & Tagging

**Context:**
Implement clip classification/tagging feature to allow users to tag clips with emotions/categories (exciting, sad, happy, etc.). This requires product decision: Is classification required for v1?

**Files & modules likely involved:**
- `supabase/migrations/` — Migration to add classification columns to clips table
- `apps/web/src/pages/api/clips/[id]/classify.ts` — Classification API (to be created)
- `packages/shared/src/schemas/` — Classification schema (to be created)
- `test/api/clips.classify.test.ts` — Classification tests (to be created)

**Hard constraints:**
- Schema changes must be additive (nullable columns)
- No breaking changes to existing clips
- `test:core` must remain green
- Classification must respect workspace boundaries (RLS)

**Success criteria:**
- Classification columns added to clips table (nullable)
- Classification API endpoints exist
- Classification is workspace-scoped
- Unit and integration tests exist
- Migration documented

---

### 5.T5 — Deployment, Ops & Production Hardening

**Context:**
Document migration application process and verify production configurations (Sentry, Stripe, deployment pipeline). Some items require Person 2 (Stripe verification).

**Files & modules likely involved:**
- `REPORTS/backend_ops_runbook.md` — Ops runbook (to be updated)
- `supabase/migrations/` — Migration files (for rollback tests)
- `test/db/migration-rollback.test.ts` — Migration rollback tests (to be created)
- Production configs (Sentry, Stripe, Vercel) — Manual verification

**Hard constraints:**
- Documentation only (no code changes for J-01, J-02)
- Migration rollback tests must not break existing migrations
- `test:core` must remain green
- Production verification requires production access

**Success criteria:**
- Migration application process documented
- Deployment pipeline documented
- Sentry configuration verified
- Stripe configuration verified (Person 2)
- Migration rollback tests exist
- `backend_ops_runbook.md` updated

---

### 5.T6 — Licensing & Dependency Risk

**Context:**
Add LICENSE file to repository root and run dependency audit to check for security vulnerabilities and license compatibility.

**Files & modules likely involved:**
- `LICENSE` — License file (to be created at root)
- `package.json` (root, apps/*, packages/*) — Dependency declarations
- `REPORTS/dependency-audit.md` — Audit documentation (to be created)

**Hard constraints:**
- No code changes
- License file only
- Audit documentation only

**Success criteria:**
- LICENSE file exists at repository root
- Dependency audit run (`pnpm audit`)
- License compatibility reviewed (no AGPL or problematic licenses)
- Audit results documented

---

**End of Build Tracks Document**
