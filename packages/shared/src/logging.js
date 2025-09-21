export function log(entry) {
    try {
        console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
    }
    catch {
        console.log(JSON.stringify({ ts: new Date().toISOString(), service: "api", msg: "log_error" }));
    }
}
