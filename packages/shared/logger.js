export function logJSON(obj) {
    try {
        process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
    }
    catch { /* noop */ }
}
