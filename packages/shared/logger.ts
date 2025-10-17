export function logJSON(obj: Record<string, unknown>) {
  try {
    process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...obj }) + "\n");
  } catch { /* noop */ }
}
