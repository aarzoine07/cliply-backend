#!/bin/bash
# Verification script for plan gate functionality
# Usage: ./scripts/verify-plan-gate.sh <workspace_id>

set -e

WSID="${1:-00000000-0000-0000-0000-000000000001}"

if [ -z "$WSID" ]; then
  echo "Usage: $0 <workspace_id>"
  exit 1
fi

echo "🔍 Verifying plan gate for workspace: $WSID"
echo ""

# Check if using local Supabase or cloud
if [ -f "supabase/config.toml" ] && grep -q "project_id" supabase/config.toml 2>/dev/null; then
  # Local Supabase
  echo "📦 Using local Supabase..."
  SUPABASE_CMD="supabase db execute"
else
  # Cloud Supabase - need project_ref
  PROJECT_REF=$(jq -r '.project_ref' < supabase/config.toml 2>/dev/null || echo "")
  if [ -z "$PROJECT_REF" ] || [ "$PROJECT_REF" = "null" ]; then
    echo "❌ Error: Could not determine Supabase project_ref"
    echo "   For cloud: Set SUPABASE_PROJECT_REF environment variable"
    echo "   For local: Ensure supabase/config.toml exists"
    exit 1
  fi
  echo "☁️  Using cloud Supabase project: $PROJECT_REF"
  SUPABASE_CMD="supabase sql --project-ref $PROJECT_REF"
fi

echo ""
echo "1️⃣  Ensuring 'basic' active subscription exists for workspace..."

# Note: subscriptions table uses plan_name (not plan) and requires stripe_customer_id and stripe_subscription_id
# We'll create a minimal subscription record for testing
cat <<SQL | $SUPABASE_CMD
-- Ensure a 'basic' active subscription exists (or update existing)
INSERT INTO subscriptions (
  workspace_id,
  stripe_customer_id,
  stripe_subscription_id,
  plan_name,
  price_id,
  status,
  current_period_end,
  updated_at
)
VALUES (
  '${WSID}',
  'cus_test_' || substr(md5(random()::text), 1, 14),
  'sub_test_' || substr(md5(random()::text), 1, 14),
  'basic',
  'price_test_basic',
  'active',
  now() + interval '7 days',
  now()
)
ON CONFLICT (workspace_id, stripe_subscription_id) 
DO UPDATE SET 
  status = 'active',
  plan_name = 'basic',
  updated_at = excluded.updated_at;
SQL

echo ""
echo "2️⃣  Creating a test clip (required for schedules foreign key)..."

# First, create a dummy clip if needed
CLIP_ID=$(cat <<SQL | $SUPABASE_CMD 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || echo "")
-- Get or create a test clip for this workspace
DO \$\$
DECLARE
  test_project_id uuid;
  test_clip_id uuid;
BEGIN
  -- Get or create a test project
  SELECT id INTO test_project_id
  FROM projects
  WHERE workspace_id = '${WSID}'
  LIMIT 1;

  IF test_project_id IS NULL THEN
    INSERT INTO projects (workspace_id, title, source_type, status)
    VALUES ('${WSID}', 'Test Project', 'file', 'ready')
    RETURNING id INTO test_project_id;
  END IF;

  -- Get or create a test clip
  SELECT id INTO test_clip_id
  FROM clips
  WHERE workspace_id = '${WSID}' AND project_id = test_project_id
  LIMIT 1;

  IF test_clip_id IS NULL THEN
    INSERT INTO clips (workspace_id, project_id, title, status)
    VALUES ('${WSID}', test_project_id, 'Test Clip', 'ready')
    RETURNING id INTO test_clip_id;
  END IF;

  RAISE NOTICE 'Clip ID: %', test_clip_id;
END \$\$;
SQL
)

if [ -z "$CLIP_ID" ]; then
  echo "⚠️  Could not determine clip_id. Using fallback approach..."
  CLIP_ID="00000000-0000-0000-0000-000000000001"
fi

echo "   Using clip_id: $CLIP_ID"

echo ""
echo "3️⃣  Clearing existing today's schedules and inserting 6 schedules (basic limit is 5)..."

cat <<SQL | $SUPABASE_CMD
-- Delete existing schedules for today (cleanup)
DELETE FROM schedules
WHERE workspace_id = '${WSID}'
  AND created_at >= date_trunc('day', now())
  AND created_at < date_trunc('day', now()) + interval '1 day';

-- Insert 6 schedules for today (exceeds basic limit of 5)
DO \$\$
DECLARE
  i int;
  test_clip_id uuid;
BEGIN
  -- Get a clip_id for this workspace
  SELECT id INTO test_clip_id
  FROM clips
  WHERE workspace_id = '${WSID}'
  LIMIT 1;

  -- If no clip exists, we can't create schedules
  IF test_clip_id IS NULL THEN
    RAISE EXCEPTION 'No clip found for workspace %', '${WSID}';
  END IF;

  -- Insert 6 schedules
  FOR i IN 1..6 LOOP
    INSERT INTO schedules (workspace_id, clip_id, run_at, created_at)
    VALUES (
      '${WSID}',
      test_clip_id,
      now() + interval '1 minute' * i,
      now()
    );
  END LOOP;
END \$\$;
SQL

echo ""
echo "4️⃣  Verifying schedule count..."

COUNT=$(cat <<SQL | $SUPABASE_CMD 2>/dev/null | grep -oE '[0-9]+' | head -1 || echo "0")
SELECT COUNT(*) as count
FROM schedules
WHERE workspace_id = '${WSID}'
  AND created_at >= date_trunc('day', now())
  AND created_at < date_trunc('day', now()) + interval '1 day';
SQL
)

echo "   Found $COUNT schedules for today (basic limit: 5)"
echo ""

if [ "$COUNT" -ge 6 ]; then
  echo "✅ Schedule seeding successful!"
  echo ""
  echo "5️⃣  Testing plan gate endpoint..."
  echo "   Run: curl -i -H \"Cookie: wsid=${WSID}\" http://localhost:3000/api/test/schedule"
  echo ""
  echo "   Expected: HTTP/1.1 429 Too Many Requests"
  echo "   Expected body: { \"ok\": false, \"error\": { \"code\": \"PLAN_LIMIT_EXCEEDED\", ... } }"
else
  echo "⚠️  Warning: Expected 6 schedules, found $COUNT"
  echo "   Plan gate test may not work as expected"
fi

