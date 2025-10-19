// scripts/mint-test-jwts.mjs
import jwt from "jsonwebtoken";

// ⚠️ MUST match the jwt_secret in supabase/config.toml
const SECRET = "super-secret-local-jwt-token-with-at-least-32-characters";

// Workspace IDs used in tests
const A = "00000000-0000-0000-0000-000000000001";
const B = "00000000-0000-0000-0000-000000000002";

function mint(workspaceId) {
  return jwt.sign(
    {
      role: "authenticated",
      workspace_id: workspaceId,
      sub: `test-${workspaceId}`,
    },
    SECRET,
    {
      algorithm: "HS256",
      expiresIn: "30d", // longer lifetime for testing
    }
  );
}

console.log("SUPABASE_JWT_A=", mint(A));
console.log("SUPABASE_JWT_B=", mint(B));
