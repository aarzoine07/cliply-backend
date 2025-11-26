"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logJSON = logJSON;
function logJSON(obj) {
    try {
        process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
    }
    catch { /* noop */ }
}
//# sourceMappingURL=logger.js.map