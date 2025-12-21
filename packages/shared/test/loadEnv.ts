import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

import { config } from "dotenv";

// ✅ ESM-safe path resolution to repo root .env.test
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, "../../../.env.test");

// Always load the root .env.test for test runs
config({ path: envPath, override: true });
