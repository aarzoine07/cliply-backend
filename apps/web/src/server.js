import express from "express";
import { pgCheck } from "./lib/supabase";
const app = express();
const started = Date.now();
const PORT = Number(process.env.PORT || 3001);
const ENV = process.env.NODE_ENV || "development";
function routeIndex() {
    return ["/api/health", "/api/_routes"];
}
app.get("/api/_routes", (_req, res) => {
    res.json({ ok: true, routes: routeIndex() });
});
app.get("/api/health", async (_req, res) => {
    const payload = {
        ok: true,
        service: "api",
        env: ENV,
        uptime_ms: Date.now() - started,
        db: "error",
    };
    try {
        const db = await pgCheck();
        if (db.ok) {
            payload.db = "ok";
            payload.db_name = db.db ?? null;
        }
        else {
            payload.db_error = db.error ?? "unknown";
        }
    }
    catch (e) {
        payload.db_error = e?.message || String(e);
    }
    return res.json(payload);
});
app.listen(PORT, () => {
    console.log(JSON.stringify({
        ts: new Date().toISOString(),
        service: "api",
        event: "server_started",
        port: PORT,
        env: ENV,
    }));
});
