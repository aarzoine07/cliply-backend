import "../../sentry.server.config";
import * as Sentry from "@sentry/nextjs";
export default async function handler(req, res) {
    try {
        // Capture context before throwing
        Sentry.setContext("debug", {
            endpoint: "/api/debug-sentry",
            timestamp: new Date().toISOString(),
            method: req.method,
        });
        throw new Error("Sentry test error from web API");
    }
    catch (err) {
        Sentry.captureException(err);
        // Ensure error is flushed before responding
        await Sentry.flush(2000);
        res.status(500).json({
            ok: false,
            message: "Error captured in Sentry",
            endpoint: "/api/debug-sentry",
        });
    }
}
