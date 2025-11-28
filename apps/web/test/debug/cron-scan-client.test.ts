import { test } from "vitest";
import handler from "../../src/pages/api/cron/scan-schedules";

test("CRON_CLIENT_DEBUG", async () => {
  const mockReq: any = {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    body: {},
  };

  const mockRes: any = {
    statusCode: 0,
    jsonBody: null,
    setHeader() {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.jsonBody = body;
      console.log("---- RESPONSE ----", body);
      return this;
    },
  };

  console.log("---- ENV DUMP ----");
  console.log("CRON_SECRET:", process.env.CRON_SECRET);
  console.log("SUPABASE_URL:", process.env.SUPABASE_URL);
  console.log("SERVICE_ROLE:", process.env.SUPABASE_SERVICE_ROLE_KEY);
  console.log("ANON_KEY:", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  await handler(mockReq, mockRes);
});
