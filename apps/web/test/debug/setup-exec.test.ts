// apps/web/test/debug/setup-exec.test.ts
import { test } from "vitest";

import "../../..//packages/shared/test/setup";

// We want to see if setup.ts actually runs.
test("SETUP_EXEC_DEBUG", () => {
  console.log("---- SETUP EXECUTED ----");
});
