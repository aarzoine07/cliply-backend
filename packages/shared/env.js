"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EnvSchema = exports.clearEnvCache = exports.getEnv = void 0;
/**
 * @deprecated This file exists for backward compatibility.
 * Please import from "./src/env" or "@cliply/shared/env" instead.
 *
 * This module re-exports from the canonical env schema in src/env.ts.
 */
var env_1 = require("./src/env");
Object.defineProperty(exports, "getEnv", { enumerable: true, get: function () { return env_1.getEnv; } });
Object.defineProperty(exports, "clearEnvCache", { enumerable: true, get: function () { return env_1.clearEnvCache; } });
Object.defineProperty(exports, "EnvSchema", { enumerable: true, get: function () { return env_1.EnvSchema; } });
//# sourceMappingURL=env.js.map