/**
 * @deprecated This file exists for backward compatibility.
 * Please import from "./src/env" or "@cliply/shared/env" instead.
 * 
 * This module re-exports from the canonical env schema in src/env.ts.
 */
export {
  getEnv,
  clearEnvCache,
  EnvSchema,
  type Env,
} from "./src/env";

// Legacy type alias for backward compatibility
export type EnvType = import("./src/env").Env;
