-- test/db/rls.test.sql
-- Example usage with psql:
--   \set myuid '00000000-0000-0000-0000-000000000001'
--   select set_config('request.jwt.claims', json_build_object('sub', :'myuid')::text, true);

-- Expect: owner can see their workspace
--   SELECT id FROM workspaces WHERE owner_id = :'myuid';

-- Switch user
--   \set other '00000000-0000-0000-0000-0000000000ab'
--   select set_config('request.jwt.claims', json_build_object('sub', :'other')::text, true);

-- Expect: non-owner cannot see the owner’s workspace rows
--   SELECT count(*) = 0 AS deny FROM workspaces WHERE owner_id = :'myuid';

-- Expect: connected_accounts visible only to their user
--   SELECT count(*) = 0 AS deny FROM connected_accounts WHERE user_id = :'myuid';

-- Expect: idempotency SELECT allowed to owner; INSERT should be blocked for authenticated role
--   INSERT INTO idempotency(key, user_id, status) VALUES ('k1', :'myuid', 'pending'); -- should fail under authenticated
