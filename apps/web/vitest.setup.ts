import { resolve } from "node:path";
import dotenv from "dotenv";

// Force load .env.test into process.env BEFORE any imports happen
dotenv.config({ path: resolve(process.cwd(), ".env.test") });

// Debug to confirm
console.log("🔧 vitest.setup.ts loaded test env:", {
  SUPABASE_URL: process.env.SUPABASE_URL ? "OK" : "MISSING",
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ? "OK" : "MISSING",
  TIKTOK_ENCRYPTION_KEY: process.env.TIKTOK_ENCRYPTION_KEY ? "OK" : "MISSING",
});