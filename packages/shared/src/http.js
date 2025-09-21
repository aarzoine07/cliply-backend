// Uniform success/error envelopes + tiny helpers
export function ok(body) {
    return { ok: true, ...body };
}
export function err(code, message, details) {
    return { ok: false, code, message, details };
}
// Narrow type guard
export function isErr(x) {
    return !!x && typeof x === "object" && x.ok === false;
}
