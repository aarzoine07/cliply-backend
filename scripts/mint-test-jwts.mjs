// scripts/mint-test-jwts.mjs
import jwt from "jsonwebtoken";

// ⚠️ MUST match the jwt_secret in supabase/config.toml
const SECRET = "super-secret-jwt-token-with-at-least-32-characters";

// Workspace IDs used in tests
const WORKSPACE_A = "00000000-0000-0000-0000-000000000001";
const WORKSPACE_B = "00000000-0000-0000-0000-000000000002";

// User IDs (must match seed.sql)
const USER_A = "00000000-0000-0000-0000-000000000101";
const USER_B = "00000000-0000-0000-0000-000000000102";

function mint(userId, workspaceId) {
  return jwt.sign(
    {
      role: "authenticated",
      workspace_id: workspaceId,
      sub: userId, // sub must match auth.uid() for RLS policies
    },
    SECRET,
    {
      algorithm: "HS256",
      expiresIn: "30d", // longer lifetime for testing
    }
  );
}

console.log("SUPABASE_JWT_A=", mint(USER_A, WORKSPACE_A));
console.log("SUPABASE_JWT_B=", mint(USER_B, WORKSPACE_B));
