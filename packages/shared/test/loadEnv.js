import path from "path";
import { config } from "dotenv";
// Always load the root .env.test for test runs
config({ path: path.resolve(__dirname, "../../../../../.env.test"), override: true });
